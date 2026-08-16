import { createCountSessionToken } from '../../utils/tokenUtils.js';

// Real account sessions are Clerk's job now (see resolveAuthContext.ts) and
// aren't practical to fake in unit/integration tests without hitting Clerk's
// infra. resolveAuthContext.ts's `count_session` fallback (normally used by
// the inventory-count magic-link flow) is a fully local, JWT_SECRET-signed
// mechanism keyed by a plain local User.id — reused here as the test auth
// backdoor for any test that exercises the app over HTTP.
export function createTestToken(userId: string, role: 'USER' | 'ADMIN' | 'MANAGER' = 'USER') {
  return createCountSessionToken({ id: userId, role });
}

export function createAuthHeaders(token: string) {
  return {
    Cookie: `count_session=${token}`,
  };
}
