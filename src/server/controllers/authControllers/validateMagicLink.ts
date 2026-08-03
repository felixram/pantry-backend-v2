import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.ts";
import { z } from "zod";
import { verifyToken, createJWT } from "../../../utils/tokenUtils.ts";
import { User } from "../../../db/schema/users.ts";
import { eq, isNull } from "drizzle-orm";
import { STATUS } from "../../../types/user.ts";

export const validateMagicLinkProcedure = t.procedure
  .input(z.object({ token: z.string() }))
  .mutation(async ({ ctx, input }) => {
    let payload;
    try {
      payload = verifyToken(input.token);
    } catch (error) {
      if (error instanceof Error && error.name === "TokenExpiredError") {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This link has expired. Ask your admin to send a new one.",
        });
      }
      console.error({ type: "magic_link_validation_error", errorName: (error as Error).name, errorMessage: (error as Error).message });
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "This link is invalid. Ask your admin to send a new one.",
      });
    }

    if (payload.purpose !== "count_magic_link") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid token type",
      });
    }

    const [user] = await ctx.db
      .select()
      .from(User)
      .where(eq(User.id, payload.id));

    if (!user || user.deletedAt || user.status !== STATUS.active) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found or inactive" });
    }

    const sessionToken = createJWT({ id: user.id, role: user.role });
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

    ctx.res.cookie("token", sessionToken, {
      httpOnly: true,
      expires: new Date(Date.now() + sevenDays),
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    return {
      message: "Authenticated via inventory count link",
      user: { id: user.id, name: user.name, role: user.role, location_id: user.location_id ?? null },
    };
  });
