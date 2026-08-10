import { authedProcedure } from "../../trpc.ts";
import { Category } from "../../../db/schema/category.ts";
import { CategoryAudit } from "../../../db/schema/categoryAudit.ts";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { purgeExpiredDeletedCategories, CATEGORY_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredCategories.ts";

export const getDeletedCategoriesProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  await purgeExpiredDeletedCategories(ctx.db);

  const cutoff = new Date(Date.now() - CATEGORY_RESTORE_WINDOW_MS);

  const categories = await ctx.db.query.Category.findMany({
    where: and(eq(Category.tenant_id, ctx.tenantId), isNotNull(Category.deletedAt), gte(Category.deletedAt, cutoff)),
    columns: { id: true, name: true, deletedAt: true },
    orderBy: (category) => [desc(category.deletedAt)],
  });

  if (categories.length === 0) {
    return { categories: [] };
  }

  const deleteEvents = await ctx.db.query.CategoryAudit.findMany({
    where: and(
      eq(CategoryAudit.tenant_id, ctx.tenantId),
      inArray(CategoryAudit.categoryId, categories.map((category) => category.id)),
      eq(CategoryAudit.action, "deleted")
    ),
    columns: { categoryId: true, createdAt: true },
    with: { user: { columns: { name: true } } },
    orderBy: (auditRow) => [desc(auditRow.createdAt)],
  });

  const deletedByNameByCategoryId = new Map<string, string>();
  for (const event of deleteEvents) {
    if (event.categoryId && !deletedByNameByCategoryId.has(event.categoryId)) {
      deletedByNameByCategoryId.set(event.categoryId, event.user?.name || "Unknown User");
    }
  }

  return {
    categories: categories.map((category) => ({
      ...category,
      deletedByName: deletedByNameByCategoryId.get(category.id) ?? null,
    })),
  };
});
