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
  | "lock";

/**
 * Permission Matrix
 * Defines which actions each role can perform in each status
 *
 * New Permission Model:
 * - USER (Employee) owns Draft/Rejected POs
 * - ADMIN (Manager) handles approvals and workflow progression
 *
 * Key Changes:
 * - DRAFT: USER owns, ADMIN view-only
 * - PENDING_APPROVAL: USER locked out, ADMIN can approve/reject
 * - ORDERED: USER can mark as received
 * - REJECTED: Not terminal for USER - can edit and re-submit
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
    [ROLES.manager]: ["view", "approve", "reject"],
    [ROLES.admin]: ["view"],
  },
  [ORDER_STATUS.pendingApproval]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view", "approve", "reject"],
    [ROLES.admin]: ["view", "approve", "reject"],
  },
  [ORDER_STATUS.approved]: {
    [ROLES.user]: ["view"],
    [ROLES.manager]: ["view", "mark_ordered", "cancel", "unlock"],
    [ROLES.admin]: ["view", "mark_ordered", "cancel", "unlock"],
  },
  [ORDER_STATUS.ordered]: {
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
