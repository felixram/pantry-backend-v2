import { createJWT } from '../../utils/tokenUtils.js';

export function createTestToken(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return createJWT({ id: userId, role });
}

export function createAuthHeaders(token: string) {
  return {
    Cookie: `token=${token}`,
  };
}
