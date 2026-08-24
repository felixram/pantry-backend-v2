import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { User } from "../../../db/schema/users.ts";
import { Tenant } from "../../../db/schema/tenant.ts";
import { ROLES, STATUS, hasElevatedRole } from "../../../types/user.ts";
import { createMagicLinkToken } from "../../../utils/tokenUtils.ts";
import { sendInventoryCountReminder } from "../../../services/email/emailService.ts";
import { getISOWeekIdentifier } from "../../../utils/dateUtils.ts";

export const generateMagicLink = authedMutation
  .input(z.object({ userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    // Only ADMIN and MANAGER can generate magic links
    if (!hasElevatedRole(ctx.user!.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to generate count links",
      });
    }

    const [user] = await ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.id, input.userId),
          eq(User.tenant_id, ctx.tenantId),
          eq(User.role, ROLES.user),
          eq(User.status, STATUS.active),
          isNull(User.deletedAt),
        ),
      );

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Active USER-role user not found in your organisation",
      });
    }

    // MANAGER can only generate magic links for users at their location
    if (ctx.user!.role === ROLES.manager && user.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only generate magic links for users at their location",
      });
    }

    const token = createMagicLinkToken({
      id: user.id,
      role: user.role,
      purpose: "count_magic_link",
    });

    const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
    const magicLink = `${clientUrl}/count-entry?token=${token}`;

    const [tenant] = await ctx.db
      .select({ name: Tenant.name })
      .from(Tenant)
      .where(eq(Tenant.id, ctx.tenantId));

    const emailResult = await sendInventoryCountReminder({
      to: user.email,
      userName: user.name,
      magicLink,
      orgName: tenant?.name ?? "your organization",
      weekIdentifier: getISOWeekIdentifier(new Date()),
      tenantId: ctx.tenantId,
    });

    return { magicLink, userId: user.id, expiresIn: "24h", emailSent: emailResult.success };
  });
