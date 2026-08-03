import { TRPCError } from "@trpc/server";
import { User } from "../../../db/schema/users.ts";
import { Tenant } from "../../../db/schema/tenant.ts";
import { comparePassword } from "../../../utils/passwordUtils.ts";
import { t } from "../../trpc.ts";
import { z } from "zod";
import { createJWT } from "../../../utils/tokenUtils.ts";
import { and, eq, isNull } from "drizzle-orm";
import { STATUS } from "../../../types/user.ts";

export const loginProcedure = t.procedure
  .input(z.object({ email: z.string(), password: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.email, input.email), isNull(User.deletedAt)));

    const isValidUser =
      user && (await comparePassword(input.password, user.password));
    if (!isValidUser)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });

    if (user.status === STATUS.inactive)
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

    // Check if the user's tenant has been deleted
    const [tenant] = await ctx.db
      .select({ deletedAt: Tenant.deletedAt })
      .from(Tenant)
      .where(eq(Tenant.id, user.tenant_id));

    if (tenant?.deletedAt) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "This organization has been deleted. Contact support if you believe this is an error.",
      });
    }

    const token = createJWT({
      id: user.id,
      role: user.role,
    });
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

    ctx.res.cookie("token", token, {
      httpOnly: true,
      expires: new Date(Date.now() + sevenDays),
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    return { message: "User logged succesfully", user: user.name };
  });
