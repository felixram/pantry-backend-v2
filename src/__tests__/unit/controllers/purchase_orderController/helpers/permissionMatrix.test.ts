import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  canPerformAction,
  validatePermission,
  getAllowedActions,
  isTerminalStatusForRole,
  canModifyItems,
  canModifyHeader,
  canUnlockPO,
  canLockPO,
  canEditUnlockedPO,
  computeAllowedActions,
} from '../../../../../server/controllers/purchase_orderController/helpers/permissionMatrix.js';
import { ORDER_STATUS } from '../../../../../types/orders.js';
import { ROLES } from '../../../../../types/user.js';

describe('unit | permissionMatrix (PO action gating)', () => {
  describe('canPerformAction / validatePermission', () => {
    it('USER can submit their own DRAFT for approval', () => {
      expect(canPerformAction(ROLES.user, ORDER_STATUS.draft, 'submit_for_approval')).toBe(true);
    });

    it('USER cannot approve a DRAFT directly', () => {
      expect(canPerformAction(ROLES.user, ORDER_STATUS.draft, 'approve')).toBe(false);
    });

    it('MANAGER can approve/reject a DRAFT directly (fast-track) but cannot submit_for_approval', () => {
      expect(canPerformAction(ROLES.manager, ORDER_STATUS.draft, 'approve')).toBe(true);
      expect(canPerformAction(ROLES.manager, ORDER_STATUS.draft, 'reject')).toBe(true);
      expect(canPerformAction(ROLES.manager, ORDER_STATUS.draft, 'submit_for_approval')).toBe(false);
    });

    it('email_supplier only appears for MANAGER/ADMIN on an APPROVED order — a USER never authorizes spend', () => {
      expect(canPerformAction(ROLES.manager, ORDER_STATUS.approved, 'email_supplier')).toBe(true);
      expect(canPerformAction(ROLES.user, ORDER_STATUS.approved, 'email_supplier')).toBe(false);
    });

    it('unknown status returns false rather than throwing', () => {
      expect(canPerformAction(ROLES.admin, 'NOT_A_REAL_STATUS', 'view')).toBe(false);
    });

    it('validatePermission throws a FORBIDDEN TRPCError with an action-specific message on denial', () => {
      try {
        validatePermission(ROLES.user, ORDER_STATUS.approved, 'cancel');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('FORBIDDEN');
        expect((err as TRPCError).message).toContain('cancel');
      }
    });

    it('validatePermission does not throw when the action is allowed', () => {
      expect(() => validatePermission(ROLES.user, ORDER_STATUS.draft, 'delete')).not.toThrow();
    });
  });

  describe('getAllowedActions / canModifyItems / canModifyHeader', () => {
    it('returns the exact allowed-action set for USER on a DRAFT', () => {
      expect(getAllowedActions(ROLES.user, ORDER_STATUS.draft).sort()).toEqual(
        ['view', 'edit_header', 'edit_items', 'delete', 'submit_for_approval'].sort()
      );
    });

    it('returns an empty array for an unknown role', () => {
      expect(getAllowedActions('NOT_A_REAL_ROLE' as never, ORDER_STATUS.draft)).toEqual([]);
    });

    it('canModifyItems/canModifyHeader mirror edit_items/edit_header — locked out once PENDING_APPROVAL', () => {
      expect(canModifyItems(ROLES.user, ORDER_STATUS.draft)).toBe(true);
      expect(canModifyItems(ROLES.user, ORDER_STATUS.pendingApproval)).toBe(false);
      expect(canModifyHeader(ROLES.user, ORDER_STATUS.draft)).toBe(true);
      expect(canModifyHeader(ROLES.user, ORDER_STATUS.pendingApproval)).toBe(false);
    });
  });

  describe('isTerminalStatusForRole (same asymmetric REJECTED rule as statusValidation.ts)', () => {
    it('REJECTED is terminal for MANAGER/ADMIN but not for USER', () => {
      expect(isTerminalStatusForRole(ORDER_STATUS.rejected, ROLES.manager)).toBe(true);
      expect(isTerminalStatusForRole(ORDER_STATUS.rejected, ROLES.admin)).toBe(true);
      expect(isTerminalStatusForRole(ORDER_STATUS.rejected, ROLES.user)).toBe(false);
    });

    it('RECEIVED/CANCELLED are terminal for everyone', () => {
      expect(isTerminalStatusForRole(ORDER_STATUS.received, ROLES.user)).toBe(true);
      expect(isTerminalStatusForRole(ORDER_STATUS.cancelled, ROLES.admin)).toBe(true);
    });
  });

  describe('canUnlockPO / canLockPO / canEditUnlockedPO (the "unlocked APPROVED PO" edit exception)', () => {
    it('canUnlockPO: only an elevated role, only on an APPROVED order', () => {
      expect(canUnlockPO(ORDER_STATUS.approved, ROLES.manager)).toBe(true);
      expect(canUnlockPO(ORDER_STATUS.approved, ROLES.user)).toBe(false);
      expect(canUnlockPO(ORDER_STATUS.draft, ROLES.admin)).toBe(false);
    });

    it('canLockPO requires status=APPROVED, is_unlocked=true, and an elevated role — all three', () => {
      expect(canLockPO({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.manager)).toBe(true);
      expect(canLockPO({ status: ORDER_STATUS.approved, is_unlocked: false }, ROLES.manager)).toBe(false);
      expect(canLockPO({ status: ORDER_STATUS.draft, is_unlocked: true }, ROLES.manager)).toBe(false);
      expect(canLockPO({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.user)).toBe(false);
    });

    it('canEditUnlockedPO has the identical gating to canLockPO', () => {
      expect(canEditUnlockedPO({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.admin)).toBe(true);
      expect(canEditUnlockedPO({ status: ORDER_STATUS.approved, is_unlocked: false }, ROLES.admin)).toBe(false);
    });
  });

  describe('computeAllowedActions (frontend button-rendering source of truth)', () => {
    it('adds "lock" only when the PO is an unlocked APPROVED order for an elevated role', () => {
      const unlocked = computeAllowedActions({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.manager);
      expect(unlocked).toContain('lock');

      const locked = computeAllowedActions({ status: ORDER_STATUS.approved, is_unlocked: false }, ROLES.manager);
      expect(locked).not.toContain('lock');
    });

    it('adds edit_header/edit_items for an unlocked APPROVED order even though PERMISSION_MATRIX itself grants no edit rights at APPROVED', () => {
      // Baseline: PERMISSION_MATRIX alone does not grant edit_items at APPROVED.
      expect(canPerformAction(ROLES.manager, ORDER_STATUS.approved, 'edit_items')).toBe(false);
      // But the unlocked-PO runtime exception adds it back in via computeAllowedActions.
      const actions = computeAllowedActions({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.manager);
      expect(actions).toContain('edit_items');
      expect(actions).toContain('edit_header');
    });

    it('never adds lock/edit-unlocked actions for a non-elevated role, regardless of is_unlocked', () => {
      const actions = computeAllowedActions({ status: ORDER_STATUS.approved, is_unlocked: true }, ROLES.user);
      expect(actions).not.toContain('lock');
      expect(actions).not.toContain('edit_items');
    });

    it('base PERMISSION_MATRIX actions still come through unchanged on a DRAFT (is_unlocked is meaningless there)', () => {
      const actions = computeAllowedActions({ status: ORDER_STATUS.draft, is_unlocked: true }, ROLES.user);
      expect(actions.sort()).toEqual(['view', 'edit_header', 'edit_items', 'delete', 'submit_for_approval'].sort());
    });
  });
});
