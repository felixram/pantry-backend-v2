import { t } from "../../trpc.ts"
import { updateUser } from "../../controllers/userControllers/update.ts"
import { deleteUserProcedure } from "../../controllers/userControllers/delete.ts"
import { reactivateUserProcedure } from "../../controllers/userControllers/reactivate.ts"
import { hardDeleteUserProcedure } from "../../controllers/userControllers/hardDelete.ts"
import { adminUpdateProcedure } from "../../controllers/userControllers/adminUpdate.ts"
import { getAllUsersProcedure } from "../../controllers/userControllers/getAll.ts"
import { getUserByIdProcedure } from "../../controllers/userControllers/getById.ts"
import { inviteUserProcedure } from "../../controllers/userControllers/invite.ts"
import { resendInvitationProcedure } from "../../controllers/userControllers/resendInvitation.ts"
import { getPendingInvitationsProcedure } from "../../controllers/userControllers/getPendingInvitations.ts"
import { revokeInvitationProcedure } from "../../controllers/userControllers/revokeInvitation.ts"

export const userRouter = t.router({
  update: updateUser,
  adminUpdate: adminUpdateProcedure,
  delete: deleteUserProcedure,
  reactivate: reactivateUserProcedure,
  hardDelete: hardDeleteUserProcedure,
  getAll: getAllUsersProcedure,
  getById: getUserByIdProcedure,
  invite: inviteUserProcedure,
  resendInvitation: resendInvitationProcedure,
  getPendingInvitations: getPendingInvitationsProcedure,
  revokeInvitation: revokeInvitationProcedure,
})
