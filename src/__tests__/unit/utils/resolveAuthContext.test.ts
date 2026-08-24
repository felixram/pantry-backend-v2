import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Request } from 'express';

// resolveAuthContext.ts has exactly two external dependencies: Clerk's
// getAuth() and the DB. Mocking both lets us drive the REAL function
// through every real branch without a live database — this is standard
// dependency mocking, not reimplementing the logic under test (see the
// shadow-test anti-pattern found in __tests__/unit/controllers/*.test.ts,
// which this file deliberately does not repeat).
const mockGetAuth = vi.fn();
vi.mock('@clerk/express', () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
}));

let mockQueryResult: unknown[] = [];
const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  innerJoin: vi.fn(() => mockDb),
  where: vi.fn(() => mockDb),
  then: (resolve: (rows: unknown[]) => void) => resolve(mockQueryResult),
};
vi.mock('../../../db/index.js', () => ({ db: mockDb }));

const { resolveAuthContext } = await import('../../../utils/resolveAuthContext.js');
const { createCountSessionToken } = await import('../../../utils/tokenUtils.js');

function fakeRequest(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

const dbRow = {
  id: 'user-1',
  role: 'ADMIN',
  location_id: null,
  tenant_id: 'tenant-1',
  tenant_is_demo: false,
};

describe('unit | resolveAuthContext', () => {
  beforeAll(() => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing_only';
    }
  });

  beforeEach(() => {
    mockGetAuth.mockReset();
    mockQueryResult = [];
    mockDb.select.mockClear();
  });

  describe('Clerk session path (userId + orgId present)', () => {
    it('returns the full context when the local User/Tenant row is found', async () => {
      mockGetAuth.mockReturnValue({ userId: 'clerk_user_1', orgId: 'clerk_org_1' });
      mockQueryResult = [dbRow];

      const ctx = await resolveAuthContext(fakeRequest());

      expect(ctx.user).toEqual({ id: 'user-1', role: 'ADMIN' });
      expect(ctx.tenantId).toBe('tenant-1');
      expect(ctx.clerkUserId).toBe('clerk_user_1');
      expect(ctx.clerkOrgId).toBe('clerk_org_1');
    });

    it('returns an empty context when Clerk auth is valid but no local row matches (e.g. user removed from tenant)', async () => {
      mockGetAuth.mockReturnValue({ userId: 'clerk_user_1', orgId: 'clerk_org_1' });
      mockQueryResult = [];

      const ctx = await resolveAuthContext(fakeRequest());

      expect(ctx.user).toBeNull();
      expect(ctx.tenantId).toBeNull();
      expect(ctx.clerkUserId).toBeNull();
      expect(ctx.clerkOrgId).toBeNull();
    });

    it('defaults isDemoTenant to false when the joined tenant_is_demo comes back null/undefined', async () => {
      mockGetAuth.mockReturnValue({ userId: 'clerk_user_1', orgId: 'clerk_org_1' });
      mockQueryResult = [{ ...dbRow, tenant_is_demo: null }];

      const ctx = await resolveAuthContext(fakeRequest());

      expect(ctx.isDemoTenant).toBe(false);
    });

    it('requires BOTH userId and orgId — userId alone falls through to the magic-link/empty path', async () => {
      mockGetAuth.mockReturnValue({ userId: 'clerk_user_1', orgId: null });

      const ctx = await resolveAuthContext(fakeRequest());

      expect(ctx.user).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('magic-link (count_session) path — no Clerk session', () => {
    beforeEach(() => {
      mockGetAuth.mockReturnValue({ userId: null, orgId: null });
    });

    it('returns the local context for a valid magic-link token', async () => {
      const token = createCountSessionToken({ id: 'user-1', role: 'USER', purpose: 'count_magic_link' });
      mockQueryResult = [{ ...dbRow, id: 'user-1', role: 'USER' }];

      const ctx = await resolveAuthContext(fakeRequest({ count_session: token }));

      expect(ctx.user).toEqual({ id: 'user-1', role: 'USER' });
      expect(ctx.clerkUserId).toBeNull();
      expect(ctx.clerkOrgId).toBeNull();
    });

    it('returns an empty context for a malformed/invalid magic-link token, without ever querying the DB', async () => {
      const ctx = await resolveAuthContext(fakeRequest({ count_session: 'not-a-real-token' }));

      expect(ctx.user).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('returns an empty context for an expired magic-link token', async () => {
      // Sign directly with a negative expiry rather than depending on
      // tokenUtils' fixed 24h expiry.
      const jwt = (await import('jsonwebtoken')).default;
      const expired = jwt.sign({ id: 'user-1', role: 'USER', purpose: 'count_magic_link' }, process.env.JWT_SECRET!, {
        expiresIn: '-1s',
      });

      const ctx = await resolveAuthContext(fakeRequest({ count_session: expired }));

      expect(ctx.user).toBeNull();
    });

    it('returns an empty context when there is no session and no cookie at all', async () => {
      const ctx = await resolveAuthContext(fakeRequest());

      expect(ctx.user).toBeNull();
      expect(ctx.isDemoTenant).toBe(false);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });
});
