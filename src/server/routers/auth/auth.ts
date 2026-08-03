import { t } from "../../trpc.ts"
import {
  loginProcedure,
  logoutProcedure,
  currentProcedure,
  tenantSignupProcedure,
  acceptInvitationProcedure,
  forgotPasswordProcedure,
  resetPasswordProcedure,
  validateMagicLinkProcedure,
} from "../../controllers/authControllers/index.ts"

// Auth routes: login, logout, tenant signup, accept invitation, password reset
export const authRouter = t.router({
  login: loginProcedure,
  logout: logoutProcedure,
  current: currentProcedure,
  tenantSignup: tenantSignupProcedure,
  acceptInvitation: acceptInvitationProcedure,
  forgotPassword: forgotPasswordProcedure,
  resetPassword: resetPasswordProcedure,
  validateMagicLink: validateMagicLinkProcedure,
})
