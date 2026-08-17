import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Category } from "../../../db/schema/category.ts";
import { CategoryAudit } from "../../../db/schema/categoryAudit.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { CATEGORY_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredCategories.ts";

export const restoreCategoryProcedure = adminMutation
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const category = await ctx.db.query.Category.findFirst({
      where: and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId), isNotNull(Category.deletedAt)),
      columns: { id: true, name: true, deletedAt: true },
    });

    if (!category) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Deleted category not found." });
    }

    const deletedAt = category.deletedAt as Date;
    if (Date.now() - deletedAt.getTime() > CATEGORY_RESTORE_WINDOW_MS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This category's recovery window has expired and it can no longer be restored.",
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(Category).set({ deletedAt: null }).where(eq(Category.id, input.id));
      await tx.insert(CategoryAudit).values({
        categoryId: input.id,
        categoryName: category.name,
        tenant_id: ctx.tenantId!,
        action: "restored",
        userId: ctx.user!.id,
      });
    });

    return { message: "Category restored successfully." };
  });
