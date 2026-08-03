import { TRPCError } from "@trpc/server"
import { adminMutation } from "../../trpc.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { User } from "../../../db/schema/users.ts"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { ROLES, STATUS } from "../../../types/user.ts"

export const deleteTenantProcedure = adminMutation
  .input(
    z.object({
      confirmationName: z
        .string()
        .min(1, "Please type the organization name to confirm."),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Strictly ADMIN only — too destructive for MANAGER
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can delete the organization.",
      })
    }

    const [tenant] = await ctx.db
      .select({ id: Tenant.id, name: Tenant.name })
      .from(Tenant)
      .where(and(eq(Tenant.id, ctx.tenantId!), isNull(Tenant.deletedAt)))

    if (!tenant) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found.",
      })
    }

    // Confirmation check — name must match exactly (case-insensitive)
    if (
      input.confirmationName.trim().toLowerCase() !==
      tenant.name.trim().toLowerCase()
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Organization name does not match. Please type the exact name to confirm deletion.",
      })
    }

    await ctx.db.transaction(async (tx) => {
      // Soft-delete all users in this tenant (defense-in-depth)
      await tx
        .update(User)
        .set({ deletedAt: new Date(), status: STATUS.inactive })
        .where(and(eq(User.tenant_id, tenant.id), isNull(User.deletedAt)))

      // Soft-delete the tenant
      await tx
        .update(Tenant)
        .set({ deletedAt: new Date() })
        .where(eq(Tenant.id, tenant.id))
    })

    // Clear the requesting admin's auth cookie
    ctx.res.cookie("token", "", {
      httpOnly: true,
      expires: new Date(0),
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    })

    return {
      message: "Organization has been deleted. All users have been logged out.",
    }
  })
