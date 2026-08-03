import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Category } from "../../../db/schema/category.ts";
import { eq, ilike, sql, and, getTableColumns } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const getAllCategoryProcedure = authedProcedure
  .input(
    z.object({
      id: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional().default(10),
      offset: z.number().optional().default(0),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const results = await ctx.db
      .select({
        ...getTableColumns(Category),
        totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
      })
      .from(Category)
      .where(
        and(
          eq(Category.tenant_id, ctx.tenantId),
          input.search
            ? ilike(Category.name, `%${input.search}%`)
            : input.id
              ? eq(Category.id, input.id)
              : sql`TRUE`
        )
      )
      .limit(input.limit)
      .offset(input.offset);

    const totalCount = results[0]?.totalCount ?? 0;

    return {
      results,
      pagination: {
        total: totalCount,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil(totalCount / input.limit),
      },
    };
  });
