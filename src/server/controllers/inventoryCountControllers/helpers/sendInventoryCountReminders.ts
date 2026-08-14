import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../../db/index.ts";
import { Location } from "../../../../db/schema/location.ts";
import { User } from "../../../../db/schema/users.ts";
import { Tenant } from "../../../../db/schema/tenant.ts";
import { STATUS, ROLES } from "../../../../types/user.ts";
import { doesScheduleMatchNow } from "../../../../utils/countReminderSchedule.ts";
import { createMagicLinkToken } from "../../../../utils/tokenUtils.ts";
import { sendInventoryCountReminder } from "../../../../services/email/emailService.ts";
import { getISOWeekIdentifier } from "../../../../utils/dateUtils.ts";
import { logger } from "../../../../utils/logger.ts";

export interface SendInventoryCountRemindersResult {
  weekIdentifier: string;
  emailsSent: number;
  emailsFailed: number;
  locationsMatched: number;
  locationsSkippedAlreadySent: number;
  locationsFallbackUsed: number;
  locationsNoRecipient: number;
}

interface NotifyTarget {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantName: string;
  locationId: string;
  isFallback: boolean;
}

/**
 * Finds every location whose weekly count-reminder schedule matches `now`
 * (in the location's own timezone — see countReminderSchedule.ts) and
 * emails a magic-link reminder to its designated counter.
 *
 * Two hardening behaviors beyond the original implementation:
 *  - Idempotency: a location already stamped for the current ISO week is
 *    skipped, so re-running (a cron retry, a manual re-trigger) can't send
 *    duplicate reminders to the same person.
 *  - Fallback: if the designated user is inactive/deleted, falls back to
 *    the first active MANAGER at that location (ADMINs aren't tied to a
 *    location, so they're not eligible fallback recipients) instead of the
 *    location silently never getting reminded again.
 *
 * Called from the /api/cron/inventory-reminder endpoint in index.ts.
 */
export async function sendInventoryCountReminders(
  database: typeof db = db,
  now: Date = new Date(),
): Promise<SendInventoryCountRemindersResult> {
  const weekIdentifier = getISOWeekIdentifier(now);
  const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";

  const enabledLocations = await database
    .select({
      id: Location.id,
      count_reminder_day: Location.count_reminder_day,
      count_reminder_time: Location.count_reminder_time,
      count_reminder_tz: Location.count_reminder_tz,
      count_designated_user_id: Location.count_designated_user_id,
      last_reminder_sent_week_identifier: Location.last_reminder_sent_week_identifier,
      tenantName: Tenant.name,
    })
    .from(Location)
    .innerJoin(Tenant, and(eq(Location.tenant_id, Tenant.id), eq(Tenant.is_demo, false), isNull(Tenant.deletedAt)))
    .where(and(eq(Location.count_reminder_enabled, true), isNull(Location.deletedAt)));

  let locationsMatched = 0;
  let locationsSkippedAlreadySent = 0;
  const designatedUserIdByLocation = new Map<string, string>();
  const tenantNameByLocation = new Map<string, string>();

  for (const loc of enabledLocations) {
    if (loc.count_reminder_day === null || !loc.count_reminder_time || !loc.count_designated_user_id) continue;

    const matches = doesScheduleMatchNow(
      { day: loc.count_reminder_day, time: loc.count_reminder_time, tz: loc.count_reminder_tz },
      now,
    );
    if (!matches) continue;

    locationsMatched++;

    if (loc.last_reminder_sent_week_identifier === weekIdentifier) {
      locationsSkippedAlreadySent++;
      logger.info({ locationId: loc.id, weekIdentifier }, "Inventory reminder: already sent this week, skipping");
      continue;
    }

    designatedUserIdByLocation.set(loc.id, loc.count_designated_user_id);
    tenantNameByLocation.set(loc.id, loc.tenantName);
  }

  const matchedLocationIds = [...designatedUserIdByLocation.keys()];

  if (matchedLocationIds.length === 0) {
    logger.info({ weekIdentifier }, "Inventory reminder cron: no locations to notify this hour");
    return {
      weekIdentifier,
      emailsSent: 0,
      emailsFailed: 0,
      locationsMatched,
      locationsSkippedAlreadySent,
      locationsFallbackUsed: 0,
      locationsNoRecipient: 0,
    };
  }

  // Resolve the designated user for each matched location, if still active.
  const designatedUserIds = [...new Set(designatedUserIdByLocation.values())];
  const activeDesignatedUsers = await database
    .select({ id: User.id, name: User.name, email: User.email, role: User.role })
    .from(User)
    .where(and(eq(User.status, STATUS.active), isNull(User.deletedAt), inArray(User.id, designatedUserIds)));
  const activeUserById = new Map(activeDesignatedUsers.map((u) => [u.id, u]));

  // For locations whose designated user isn't active, look for a fallback:
  // the first active MANAGER assigned to that same location.
  const locationIdsNeedingFallback = matchedLocationIds.filter(
    (locId) => !activeUserById.has(designatedUserIdByLocation.get(locId)!),
  );
  const fallbackByLocation = new Map<string, { id: string; name: string; email: string; role: string }>();
  if (locationIdsNeedingFallback.length > 0) {
    const fallbackCandidates = await database
      .select({ id: User.id, name: User.name, email: User.email, role: User.role, location_id: User.location_id })
      .from(User)
      .where(
        and(
          eq(User.status, STATUS.active),
          isNull(User.deletedAt),
          eq(User.role, ROLES.manager),
          inArray(User.location_id, locationIdsNeedingFallback),
        ),
      );
    for (const locId of locationIdsNeedingFallback) {
      const candidate = fallbackCandidates.find((u) => u.location_id === locId);
      if (candidate) fallbackByLocation.set(locId, candidate);
    }
  }

  const targets: NotifyTarget[] = [];
  let locationsFallbackUsed = 0;
  let locationsNoRecipient = 0;
  const locationsToStamp: string[] = [];

  for (const locId of matchedLocationIds) {
    const designated = activeUserById.get(designatedUserIdByLocation.get(locId)!);
    const tenantName = tenantNameByLocation.get(locId) ?? "your organization";

    if (designated) {
      targets.push({ ...designated, tenantName, locationId: locId, isFallback: false });
      locationsToStamp.push(locId);
      continue;
    }

    const fallback = fallbackByLocation.get(locId);
    if (fallback) {
      locationsFallbackUsed++;
      logger.info(
        { locationId: locId, fallbackUserId: fallback.id },
        "Inventory reminder: designated counter inactive, falling back to location manager",
      );
      targets.push({ ...fallback, tenantName, locationId: locId, isFallback: true });
      locationsToStamp.push(locId);
    } else {
      locationsNoRecipient++;
      logger.warn(
        { locationId: locId },
        "Inventory reminder: designated counter inactive and no fallback manager found — skipping, nothing sent",
      );
    }
  }

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const token = createMagicLinkToken({ id: target.id, role: target.role, purpose: "count_magic_link" });
      const magicLink = `${clientUrl}/count-entry?token=${token}`;
      return sendInventoryCountReminder({
        to: target.email,
        userName: target.name,
        magicLink,
        orgName: target.tenantName,
        weekIdentifier,
      });
    }),
  );

  const emailsSent = results.filter((r) => r.status === "fulfilled").length;
  const emailsFailed = results.filter((r) => r.status === "rejected").length;

  // Stamp every location we attempted (not just successful sends) — matches
  // suggested_pos_created_at's "attempted, not confirmed-delivered" meaning
  // elsewhere in this codebase, and avoids retrying indefinitely against a
  // permanently-bouncing address for the rest of the week.
  if (locationsToStamp.length > 0) {
    await database
      .update(Location)
      .set({ last_reminder_sent_week_identifier: weekIdentifier, last_reminder_sent_at: now })
      .where(inArray(Location.id, locationsToStamp));
  }

  logger.info(
    {
      weekIdentifier,
      emailsSent,
      emailsFailed,
      locationsMatched,
      locationsSkippedAlreadySent,
      locationsFallbackUsed,
      locationsNoRecipient,
    },
    "Inventory reminder cron completed",
  );

  return {
    weekIdentifier,
    emailsSent,
    emailsFailed,
    locationsMatched,
    locationsSkippedAlreadySent,
    locationsFallbackUsed,
    locationsNoRecipient,
  };
}
