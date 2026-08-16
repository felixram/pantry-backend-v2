import { TRPCError } from "@trpc/server"
import { clerkClient } from "@clerk/express"
import { adminMutation } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts"
import { and, eq, count } from "drizzle-orm"
import { z } from "zod"
import { ROLES } from "../../../types/user.ts"
import { logger } from "../../../utils/logger.ts"

export const hardDeleteUserProcedure = adminMutation
  .input(
    z.object({
      userId: z.string(),
      reason: z.string().min(10, "Reason must be at least 10 characters"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Was unscoped by tenant — any elevated user in any tenant could
    // permanently delete any other tenant's user by id.
    const [userToDelete] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)))

    if (!userToDelete) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      })
    }

    // MANAGER can only hard delete users in their location
    if (ctx.user!.role === ROLES.manager && userToDelete.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only manage users in your location",
      })
    }

    if (!userToDelete.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only soft-deleted users can be hard deleted",
      })
    }

    // Check if user has any audit log references
    const auditCountResult = await ctx.db
      .select({ count: count() })
      .from(PurchaseOrderAudit)
      .where(eq(PurchaseOrderAudit.userId, input.userId))

    const auditCount = auditCountResult[0]?.count || 0
    if (auditCount > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Cannot hard delete: User has ${auditCount} audit ${auditCount === 1 ? "entry" : "entries"}`,
      })
    }

    // Safe to delete - permanently remove the user
    await ctx.db.delete(User).where(and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)))

    // Best-effort: also delete the Clerk User account entirely (our model is
    // 1 user = 1 tenant membership). A Clerk-side failure here shouldn't
    // block the local hard-delete this procedure exists for.
    if (userToDelete.clerk_user_id) {
      try {
        await clerkClient.users.deleteUser(userToDelete.clerk_user_id)
      } catch (err) {
        logger.error({ err, clerkUserId: userToDelete.clerk_user_id }, "Failed to delete Clerk user after local hard delete")
      }
    }

    return {
      message: "User has been permanently deleted",
    }
  })
