const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface CountReminderSchedule {
  /** 0=Sun … 6=Sat */
  day: number;
  /** "HH:MM" in the given timezone — only the hour is matched (hourly poll). */
  time: string;
  /** IANA timezone, e.g. "America/New_York". Falls back to UTC if null. */
  tz: string | null;
}

/**
 * Does this location's weekly reminder schedule match the given instant?
 *
 * The reminder cron polls once an hour rather than scheduling a job per
 * location/timezone, so "match" means: converting `now` into the location's
 * own IANA timezone, does today's weekday + hour equal the configured day +
 * hour? Using Intl.DateTimeFormat for the conversion means DST transitions
 * are handled correctly for free — no manual offset math.
 *
 * Extracted out of the /api/cron/inventory-reminder route handler so this
 * logic (the only DST-sensitive part of the whole feature) is unit-testable
 * without a database or an HTTP request.
 */
export function doesScheduleMatchNow(schedule: CountReminderSchedule, now: Date): boolean {
  const tz = schedule.tz ?? "UTC";

  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        hour12: false,
      })
        .formatToParts(now)
        .map(({ type, value }) => [type, value]),
    );
  } catch {
    // Invalid/unrecognized IANA timezone string — caller logs this, we just
    // report "no match" rather than throwing and taking down the whole
    // batch over one bad location.
    return false;
  }

  const localDay = DAY_NAMES.indexOf((parts.weekday ?? "") as (typeof DAY_NAMES)[number]);
  const localHour = parseInt(parts.hour ?? "-1", 10);
  const [scheduledHour] = schedule.time.split(":").map(Number);

  return localDay === schedule.day && localHour === scheduledHour;
}
