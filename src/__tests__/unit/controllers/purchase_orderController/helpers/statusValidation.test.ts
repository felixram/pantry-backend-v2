import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  validateStatusTransition,
  validateRoleStatusTransition,
  isTerminalState,
  isTerminalStateForRole,
  getValidNextStatuses,
  getValidNextStatusesForRole,
  canTransitionStatus,
} from '../../../../../server/controllers/purchase_orderController/helpers/statusValidation.js';
import { ORDER_STATUS } from '../../../../../types/orders.js';
import { ROLES } from '../../../../../types/user.js';

describe('unit | statusValidation (PO state machine)', () => {
  describe('validateStatusTransition (base, role-agnostic)', () => {
    it('does not throw for a valid transition', () => {
      expect(() => validateStatusTransition(ORDER_STATUS.draft, ORDER_STATUS.pendingApproval)).not.toThrow();
    });

    it('throws BAD_REQUEST for an invalid transition', () => {
      expect(() => validateStatusTransition(ORDER_STATUS.draft, ORDER_STATUS.received)).toThrow(TRPCError);
      try {
        validateStatusTransition(ORDER_STATUS.draft, ORDER_STATUS.received);
      } catch (err) {
        expect((err as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('throws for any transition out of a terminal state', () => {
      expect(() => validateStatusTransition(ORDER_STATUS.received, ORDER_STATUS.draft)).toThrow();
      expect(() => validateStatusTransition(ORDER_STATUS.cancelled, ORDER_STATUS.draft)).toThrow();
    });
  });

  describe('validateRoleStatusTransition (role-aware)', () => {
    // Regression guard: the base transition map previously omitted
    // draft -> approved/rejected, which meant the base check threw BEFORE
    // the role-aware check ever ran — making this documented MANAGER
    // fast-track capability unreachable even though roleTransitions
    // granted it. Confirms it's actually reachable now.
    it('allows MANAGER to fast-track DRAFT directly to APPROVED', () => {
      expect(() => validateRoleStatusTransition(ROLES.manager, ORDER_STATUS.draft, ORDER_STATUS.approved)).not.toThrow();
    });

    it('allows ADMIN to fast-track DRAFT directly to REJECTED', () => {
      expect(() => validateRoleStatusTransition(ROLES.admin, ORDER_STATUS.draft, ORDER_STATUS.rejected)).not.toThrow();
    });

    it('rejects USER attempting the same fast-track with FORBIDDEN, not BAD_REQUEST — the base transition is valid, only the role is not', () => {
      try {
        validateRoleStatusTransition(ROLES.user, ORDER_STATUS.draft, ORDER_STATUS.approved);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('rejects a transition invalid at the base level with BAD_REQUEST even for ADMIN — role never overrides an impossible base transition', () => {
      try {
        validateRoleStatusTransition(ROLES.admin, ORDER_STATUS.draft, ORDER_STATUS.received);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('allows USER to submit a draft for approval', () => {
      expect(() =>
        validateRoleStatusTransition(ROLES.user, ORDER_STATUS.draft, ORDER_STATUS.pendingApproval)
      ).not.toThrow();
    });

    it('allows USER to mark an ORDERED PO as fully or partially received', () => {
      expect(() => validateRoleStatusTransition(ROLES.user, ORDER_STATUS.ordered, ORDER_STATUS.received)).not.toThrow();
      expect(() =>
        validateRoleStatusTransition(ROLES.user, ORDER_STATUS.ordered, ORDER_STATUS.partiallyReceived)
      ).not.toThrow();
    });

    it('rejects USER cancelling an ORDERED PO (elevated-only action)', () => {
      expect(() => validateRoleStatusTransition(ROLES.user, ORDER_STATUS.ordered, ORDER_STATUS.cancelled)).toThrow();
    });

    // The core asymmetry: REJECTED is a dead end for MANAGER/ADMIN but a
    // real recoverable state for USER (fix and resubmit).
    it('allows USER to move a REJECTED PO back to DRAFT', () => {
      expect(() => validateRoleStatusTransition(ROLES.user, ORDER_STATUS.rejected, ORDER_STATUS.draft)).not.toThrow();
    });

    it('rejects MANAGER attempting to transition a REJECTED PO at all', () => {
      expect(() => validateRoleStatusTransition(ROLES.manager, ORDER_STATUS.rejected, ORDER_STATUS.draft)).toThrow();
    });
  });

  describe('isTerminalState (global, not role-aware)', () => {
    // TERMINAL_STATES (types/orders.ts) is [received, rejected, cancelled] —
    // REJECTED counts as globally terminal here. The USER-can-still-resubmit
    // exception only exists in the role-aware isTerminalStateForRole below;
    // this global check deliberately doesn't know about roles at all.
    it('RECEIVED, REJECTED, and CANCELLED are all globally terminal', () => {
      expect(isTerminalState(ORDER_STATUS.received)).toBe(true);
      expect(isTerminalState(ORDER_STATUS.rejected)).toBe(true);
      expect(isTerminalState(ORDER_STATUS.cancelled)).toBe(true);
    });

    it('DRAFT and ORDERED are not globally terminal', () => {
      expect(isTerminalState(ORDER_STATUS.draft)).toBe(false);
      expect(isTerminalState(ORDER_STATUS.ordered)).toBe(false);
    });
  });

  describe('isTerminalStateForRole (REJECTED is the asymmetric case)', () => {
    it('REJECTED is terminal for MANAGER and ADMIN', () => {
      expect(isTerminalStateForRole(ORDER_STATUS.rejected, ROLES.manager)).toBe(true);
      expect(isTerminalStateForRole(ORDER_STATUS.rejected, ROLES.admin)).toBe(true);
    });

    it('REJECTED is NOT terminal for USER — they can still edit and resubmit', () => {
      expect(isTerminalStateForRole(ORDER_STATUS.rejected, ROLES.user)).toBe(false);
    });

    it('RECEIVED/CANCELLED are terminal for every role', () => {
      expect(isTerminalStateForRole(ORDER_STATUS.received, ROLES.user)).toBe(true);
      expect(isTerminalStateForRole(ORDER_STATUS.cancelled, ROLES.user)).toBe(true);
    });
  });

  describe('getValidNextStatuses / getValidNextStatusesForRole / canTransitionStatus', () => {
    it('getValidNextStatuses returns the base set for a status, empty array for a terminal one', () => {
      expect(getValidNextStatuses(ORDER_STATUS.approved)).toEqual([ORDER_STATUS.ordered, ORDER_STATUS.cancelled]);
      expect(getValidNextStatuses(ORDER_STATUS.received)).toEqual([]);
    });

    it('getValidNextStatusesForRole narrows by role', () => {
      expect(getValidNextStatusesForRole(ORDER_STATUS.pendingApproval, ROLES.user)).toEqual([]);
      expect(getValidNextStatusesForRole(ORDER_STATUS.pendingApproval, ROLES.manager)).toEqual([
        ORDER_STATUS.approved,
        ORDER_STATUS.rejected,
      ]);
    });

    it('canTransitionStatus reflects whether a role has ANY allowed move from the current status', () => {
      expect(canTransitionStatus(ROLES.user, ORDER_STATUS.pendingApproval)).toBe(false);
      expect(canTransitionStatus(ROLES.manager, ORDER_STATUS.pendingApproval)).toBe(true);
      expect(canTransitionStatus(ROLES.user, ORDER_STATUS.received)).toBe(false);
    });
  });
});
