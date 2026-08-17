import { TRPCError } from "@trpc/server";
import { ORDER_STATUS, type orderSatus } from "../../../../types/orders.ts";
import { ROLES, hasElevatedRole, type userRoles } from "../../../../types/user.ts";

/**
 * Purchase Order Permission Actions
 * Defines all possible actions that can be performed on a purchase order
 */
export type POPermissionAction =
  | "view"
  | "edit_header"
  | "edit_items"
  | "delete"
  | "submit_for_approval"
  | "approve"
  | "reject"
  | "mark_ordered"
  | "mark_received"
  | "cancel"
  | "move_to_draft"
  | "resubmit"
  | "unlock"
  | "lock"
  | "email_supplier";

/**
 * Permission Matrix
 * Defines which actions each role can perform in each status
 *
 * Permission Model:
 * - USER (Employee) owns Draft/Rejected POs — can originate a request but
 *   not authorize spend (a USER-created PO starts in DRAFT; an elevated-role
 *   PO starts APPROVED).
 * - MANAGER/ADMIN both handle approvals and workflow progression. ADMIN's
 *   authority is a strict superset of MANAGER's at every status, including
 *   DRAFT (both can edit a draft directly and approve/reject it) — there is
 *   no status where ADMIN has less authority than MANAGER.
 *
 * Key facts:
 * - DRAFT: USER owns; MANAGER/ADMIN can edit the draft directly and
 *   approve/reject it without waiting for PENDING_APPROVAL.
 * - PENDING_APPROVAL: USER locked out, MANAGER/ADMIN can approve/reject
 * - ORDERED: USER can mark as received
 * - PARTIALLY_RECEIVED: mirrors ORDERED exactly — a PO with progress but not
 *   full coverage is still an open, actionable order, not a different tier
 *   of authority
 * - REJECTED: Not terminal for USER - can edit and re-submit
 * - APPROVED is the only status where email_supplier appears, and only for
 *   MANAGER/ADMIN — emailing a supplier only makes sense once spend is
 *   authorized, and a regular USER never authorizes spend.
 */
const PERMISSION_MATRIX: Record<
  string,
  Record<string, POPermissionAction[]>
> = {
  [ORDER_STATUS.draft]: {
    [ROLES.user]: [
      "view",
      "edit_header",
      "edit_items",
      "delete",
      "submit_for_approval",
    ],
    [ROLES.manager]: ["view", "edit_header", "edit_items", "approve", "reject"],
    [ROLES.admin]: ["view", "edit_header", "edit_items", "approve", "reject"],
  },
  [ORDER_STATUS.pendingApproval]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view", "approve", "reject"],
    [ROLES.admin]: ["view", "approve", "reject"],
  },
  [ORDER_STATUS.approved]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view", "mark_ordered", "cancel", "unlock", "email_supplier"],
    [ROLES.admin]: ["view", "mark_ordered", "cancel", "unlock", "email_supplier"],
  },
  [ORDER_STATUS.ordered]: {
    [ROLES.user]: ["view", "mark_received"],
    [ROLES.manager]: ["view", "mark_received", "cancel"],
    [ROLES.admin]: ["view", "mark_received", "cancel"],
  },
  [ORDER_STATUS.partiallyReceived]: {
    [ROLES.user]: ["view", "mark_received"],
    [ROLES.manager]: ["view", "mark_received", "cancel"],
    [ROLES.admin]: ["view", "mark_received", "cancel"],
  },
  [ORDER_STATUS.received]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view"],
    [ROLES.admin]: ["view"],
  },
  [ORDER_STATUS.rejected]: {
    [ROLES.user]: [
      "view",
      "edit_header",
      "edit_items",
      "delete",
      "move_to_draft",
      "resubmit",
    ],
    [ROLES.manager]: ["view"],
    [ROLES.admin]: ["view"],
  },
  [ORDER_STATUS.cancelled]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view"],
    [ROLES.admin]: ["view"],
  },
};

/**
 * Checks if a role can perform a specific action on a PO in a given status
 *
 * @param role - The user's role (USER or ADMIN)
 * @param status - The current PO status
 * @param action - The action being attempted
 * @returns true if the action is allowed, false otherwise
 */
export function canPerformAction(
  role: userRoles,
  status: orderSatus | string,
  action: POPermissionAction
): boolean {
  const statusPermissions = PERMISSION_MATRIX[status];
  if (!statusPermissions) {
    return false;
  }

  const rolePermissions = statusPermissions[role];
  if (!rolePermissions) {
    return false;
  }

  return rolePermissions.includes(action);
}

/**
 * Validates if a role can perform an action, throws TRPCError if not
 *
 * @param role - The user's role (USER or ADMIN)
 * @param status - The current PO status
 * @param action - The action being attempted
 * @throws TRPCError if the action is not allowed
 */
export function validatePermission(
  role: userRoles,
  status: orderSatus | string,
  action: POPermissionAction
): void {
  if (!canPerformAction(role, status, action)) {
    const errorMessages: Record<POPermissionAction, string> = {
      view: `You do not have permission to view this purchase order in ${status} status`,
      edit_header: `You cannot edit header fields in ${status} status`,
      edit_items: `You cannot edit items in ${status} status`,
      delete: `You cannot delete a purchase order in ${status} status`,
      submit_for_approval: `You cannot submit for approval from ${status} status`,
      approve: `You cannot approve a purchase order in ${status} status`,
      reject: `You cannot reject a purchase order in ${status} status`,
      mark_ordered: `You cannot mark as ordered from ${status} status`,
      mark_received: `You cannot mark as received from ${status} status`,
      cancel: `You cannot cancel a purchase order in ${status} status`,
      move_to_draft: `You cannot move to draft from ${status} status`,
      resubmit: `You cannot resubmit from ${status} status`,
      unlock: `You cannot unlock a purchase order in ${status} status`,
      lock: `You cannot lock a purchase order in ${status} status`,
      email_supplier: `You cannot email the supplier for a purchase order in ${status} status`,
    };

    throw new TRPCError({
      code: "FORBIDDEN",
      message: errorMessages[action] || `Action '${action}' not allowed for ${role} role on ${status} status`,
    });
  }
}

/**
 * Gets all allowed actions for a role in a given status
 *
 * @param role - The user's role (USER or ADMIN)
 * @param status - The current PO status
 * @returns Array of allowed actions
 */
export function getAllowedActions(
  role: userRoles,
  status: orderSatus | string
): POPermissionAction[] {
  const statusPermissions = PERMISSION_MATRIX[status];
  if (!statusPermissions) {
    return [];
  }

  return statusPermissions[role] || [];
}

/**
 * Checks if a status is terminal for a given role
 * REJECTED is NOT terminal for USER (they can edit and re-submit)
 * RECEIVED and CANCELLED are always terminal
 *
 * @param status - The PO status
 * @param role - The user's role
 * @returns true if the status is terminal for this role
 */
export function isTerminalStatusForRole(
  status: orderSatus | string,
  role: userRoles
): boolean {
  // RECEIVED and CANCELLED are always terminal
  if (status === ORDER_STATUS.received || status === ORDER_STATUS.cancelled) {
    return true;
  }

  // REJECTED is terminal for ADMIN/MANAGER but not for USER
  if (status === ORDER_STATUS.rejected) {
    return hasElevatedRole(role);
  }

  return false;
}

/**
 * Checks if a role can modify items on a PO (add, update, remove)
 * This is a convenience function that checks the edit_items permission
 *
 * @param role - The user's role
 * @param status - The current PO status
 * @returns true if the role can modify items
 */
export function canModifyItems(
  role: userRoles,
  status: orderSatus | string
): boolean {
  return canPerformAction(role, status, "edit_items");
}

/**
 * Checks if a role can modify header fields (supplier, location)
 * This is a convenience function that checks the edit_header permission
 *
 * @param role - The user's role
 * @param status - The current PO status
 * @returns true if the role can modify header
 */
export function canModifyHeader(
  role: userRoles,
  status: orderSatus | string
): boolean {
  return canPerformAction(role, status, "edit_header");
}

/**
 * Checks if an ADMIN can unlock an APPROVED Purchase Order
 *
 * @param status - The current PO status
 * @param role - The user's role
 * @returns true if the PO can be unlocked
 */
export function canUnlockPO(
  status: orderSatus | string,
  role: userRoles
): boolean {
  return status === ORDER_STATUS.approved && hasElevatedRole(role);
}

/**
 * Checks if an ADMIN or MANAGER can lock an unlocked Purchase Order
 *
 * @param po - The purchase order with status and is_unlocked fields
 * @param role - The user's role
 * @returns true if the PO can be locked
 */
export function canLockPO(
  po: { status: string; is_unlocked: boolean },
  role: userRoles
): boolean {
  return (
    po.status === ORDER_STATUS.approved &&
    po.is_unlocked &&
    hasElevatedRole(role)
  );
}

/**
 * Checks if an ADMIN or MANAGER can edit an unlocked APPROVED Purchase Order
 * This includes editing items and header fields
 *
 * @param po - The purchase order with status and is_unlocked fields
 * @param role - The user's role
 * @returns true if the unlocked PO can be edited
 */
export function canEditUnlockedPO(
  po: { status: string; is_unlocked: boolean },
  role: userRoles
): boolean {
  return (
    po.status === ORDER_STATUS.approved &&
    po.is_unlocked &&
    hasElevatedRole(role)
  );
}

/**
 * Computes the full set of actions a role can perform on a PO right now,
 * for the frontend to render available buttons from — so the client never
 * needs its own copy of the state machine/permission rules (the v1
 * frontend hand-maintained a parallel copy of this exact logic, a standing
 * drift risk between frontend and backend).
 *
 * PERMISSION_MATRIX already covers approve/reject/mark_ordered/mark_received/
 * cancel/unlock consistently with statusValidation.ts's roleTransitions map
 * (verified entry-by-entry), so getAllowedActions() is a reliable base.
 * "lock" and the unlocked-edit permissions are the actions PERMISSION_MATRIX
 * never grants directly (their eligibility depends on runtime state —
 * is_unlocked — not just status+role), so they're computed separately here.
 */
export function computeAllowedActions(
  po: { status: string; is_unlocked: boolean },
  role: userRoles
): POPermissionAction[] {
  const actions = new Set(getAllowedActions(role, po.status));
  if (canLockPO(po, role)) {
    actions.add("lock");
  }
  if (canEditUnlockedPO(po, role)) {
    actions.add("edit_header");
    actions.add("edit_items");
  }
  return Array.from(actions);
}
