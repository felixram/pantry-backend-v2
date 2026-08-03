import { t } from "../../trpc.ts"

export const logoutProcedure = t.procedure.mutation(({ ctx }) => {
  ctx.res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  })
  return { message: "user logged out." }
})
