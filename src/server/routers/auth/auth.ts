import { t } from "../../trpc.ts"
import {
  currentProcedure,
  validateMagicLinkProcedure,
} from "../../controllers/authControllers/index.ts"

// Auth is Clerk's job now (login/logout/signup/invitations/password reset
// all happen through Clerk directly). `current` merges the Clerk-resolved
// session with our app-specific fields; `validateMagicLink` is the separate,
// Clerk-independent inventory-count staff-access flow.
export const authRouter = t.router({
  current: currentProcedure,
  validateMagicLink: validateMagicLinkProcedure,
})
