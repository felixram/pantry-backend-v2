import { TRPCError } from "@trpc/server";
import { ORDER_STATUS, TERMINAL_STATES } from "../../../../types/orders.ts";
import { ROLES, hasElevatedRole, type userRoles } from "../../../../types/user.ts";

/**
 * Status transition validation - state machine pattern
 * Defines valid transitions from each status to allowed statuses
 * This is the base transition map (no role restrictions)
 */
const validTransitions: Record<string, string[]> = {
  // Includes approved/rejected (not just pendingApproval/cancelled) because
  // MANAGER can fast-track approve/reject a DRAFT directly — see
  // roleTransitions[draft][manager] below. Previously this base map was
  // missing those two, so the role-aware check never even ran: the base
  // check threw first, making the documented MANAGER fast-track capability
  // completely unreachable in practice.
  [ORDER_STATUS.draft]: [
    ORDER_STATUS.pendingApproval,
    ORDER_STATUS.cancelled,
    ORDER_STATUS.approved,
    ORDER_STATUS.rejected,
  ],
  [ORDER_STATUS.pendingApproval]: [
    ORDER_STATUS.approved,
    ORDER_STATUS.rejected,
    ORDER_STATUS.cancelled,
  ],
  [ORDER_STATUS.approved]: [ORDER_STATUS.ordered, ORDER_STATUS.cancelled],
  [ORDER_STATUS.ordered]: [ORDER_STATUS.received, ORDER_STATUS.cancelled],
  [ORDER_STATUS.received]: [], // Terminal state
  [ORDER_STATUS.rejected]: [
    ORDER_STATUS.draft,
    ORDER_STATUS.pendingApproval,
  ], // USER can move to draft or re-submit
  [ORDER_STATUS.cancelled]: [], // Terminal state
};

/**
 * Role-aware transition map
 * Defines which transitions each role can perform
 *
 * Key differences from base transitions:
 * - USER can transition DRAFT -> PENDING_APPROVAL (submit)
 * - MANAGER/ADMIN can both transition DRAFT -> APPROVED/REJECTED directly
 *   (fast-track) — ADMIN's authority is a strict superset of MANAGER's at
 *   every status, so it can't be weaker here than MANAGER's
 * - MANAGER/ADMIN can transition PENDING_APPROVAL -> APPROVED/REJECTED
 * - MANAGER/ADMIN can transition APPROVED -> ORDERED
 * - USER can transition ORDERED -> RECEIVED (mark as received)
 * - MANAGER/ADMIN can transition ORDERED -> RECEIVED or CANCELLED
 * - USER can transition REJECTED -> DRAFT or PENDING_APPROVAL (fix & re-submit)
 */
const roleTransitions: Record<string, Record<string, string[]>> = {
  [ORDER_STATUS.draft]: {
    [ROLES.user]: [ORDER_STATUS.pendingApproval], // USER submits for approval
    [ROLES.manager]: [ORDER_STATUS.approved, ORDER_STATUS.rejected], // MANAGER can approve/reject drafts directly
    [ROLES.admin]: [ORDER_STATUS.approved, ORDER_STATUS.rejected], // ADMIN can approve/reject drafts directly too
  },
  [ORDER_STATUS.pendingApproval]: {
    [ROLES.user]: [], // USER cannot transition (locked)
    [ROLES.manager]: [
      ORDER_STATUS.approved,
      ORDER_STATUS.rejected,
    ], // MANAGER approves or rejects
    [ROLES.admin]: [
      ORDER_STATUS.approved,
      ORDER_STATUS.rejected,
    ], // ADMIN approves or rejects
  },
  [ORDER_STATUS.approved]: {
    [ROLES.user]: [], // USER cannot transition
    [ROLES.manager]: [ORDER_STATUS.ordered, ORDER_STATUS.cancelled], // MANAGER marks as ordered or cancels
    [ROLES.admin]: [ORDER_STATUS.ordered, ORDER_STATUS.cancelled], // ADMIN marks as ordered or cancels
  },
  [ORDER_STATUS.ordered]: {
    [ROLES.user]: [ORDER_STATUS.received], // USER can mark as received
    [ROLES.manager]: [ORDER_STATUS.received, ORDER_STATUS.cancelled], // MANAGER can receive or cancel
    [ROLES.admin]: [ORDER_STATUS.received, ORDER_STATUS.cancelled], // ADMIN can receive or cancel
  },
  [ORDER_STATUS.received]: {
    [ROLES.user]: [], // Terminal
    [ROLES.manager]: [], // Terminal
    [ROLES.admin]: [], // Terminal
  },
  [ORDER_STATUS.rejected]: {
    [ROLES.user]: [
      ORDER_STATUS.draft,
      ORDER_STATUS.pendingApproval,
    ], // USER can move to draft or re-submit
    [ROLES.manager]: [], // MANAGER cannot transition rejected POs
    [ROLES.admin]: [], // ADMIN cannot transition rejected POs
  },
  [ORDER_STATUS.cancelled]: {
    [ROLES.user]: [], // Terminal
    [ROLES.manager]: [], // Terminal
    [ROLES.admin]: [], // Terminal
  },
};

/**
 * Validates if a status transition is allowed according to the state machine
 * @throws TRPCError if the transition is invalid
 */
export function validateStatusTransition(
  currentStatus: string,
  newStatus: string,
): void {
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
    });
  }
}

/**
 * Validates if a status transition is allowed for a specific role
 * @throws TRPCError if the transition is invalid for this role
 */
export function validateRoleStatusTransition(
  role: userRoles,
  currentStatus: string,
  newStatus: string,
): void {
  // First check if the base transition is valid
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
    });
  }

  // Then check if this role can perform this transition
  const roleAllowedTransitions = roleTransitions[currentStatus]?.[role] || [];
  if (!roleAllowedTransitions.includes(newStatus)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${role} role cannot transition from ${currentStatus} to ${newStatus}`,
    });
  }
}

/**
 * Checks if a status is a terminal state (no further modifications allowed)
 * Note: This is the global terminal state check, not role-aware
 */
export function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.includes(status as any);
}

/**
 * Checks if a status is terminal for a specific role
 * REJECTED is NOT terminal for USER (they can edit and re-submit)
 *
 * @param status - The PO status
 * @param role - The user's role
 * @returns true if no modifications allowed for this role
 */
export function isTerminalStateForRole(status: string, role: userRoles): boolean {
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
 * Gets the valid next statuses for a given current status
 */
export function getValidNextStatuses(currentStatus: string): string[] {
  return validTransitions[currentStatus] || [];
}

/**
 * Gets the valid next statuses for a given current status and role
 */
export function getValidNextStatusesForRole(
  currentStatus: string,
  role: userRoles
): string[] {
  return roleTransitions[currentStatus]?.[role] || [];
}

/**
 * Checks if a role can perform any status transition from the current status
 */
export function canTransitionStatus(
  role: userRoles,
  currentStatus: string
): boolean {
  const allowedTransitions = roleTransitions[currentStatus]?.[role] || [];
  return allowedTransitions.length > 0;
}
