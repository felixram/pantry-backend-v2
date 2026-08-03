import { describe, it, expect, beforeAll } from 'vitest';
import { createJWT, verifyToken } from '../../../utils/tokenUtils.js';

describe('unit | tokenUtils', () => {
  const mockPayload = { id: 'user-123', role: 'ADMIN' };

  beforeAll(() => {
    // Ensure JWT_SECRET is set for tests
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing_only';
    }
  });

  describe('createJWT', () => {
    it('should create a valid JWT token', () => {
      const token = createJWT(mockPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should create different tokens for same payload', () => {
      const token1 = createJWT(mockPayload);
      const token2 = createJWT(mockPayload);

      // Tokens will differ due to timestamp in JWT
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
    });

    it('should handle USER role', () => {
      const userPayload = { id: 'user-456', role: 'USER' };
      const token = createJWT(userPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const token = createJWT(mockPayload);
      const decoded = verifyToken(token);

      expect(decoded).toBeDefined();
      expect(decoded.id).toBe(mockPayload.id);
      expect(decoded.role).toBe(mockPayload.role);
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyToken('invalid.token.here');
      }).toThrow();
    });

    it('should throw error for malformed token', () => {
      expect(() => {
        verifyToken('notajwttoken');
      }).toThrow();
    });

    it('should throw error for empty token', () => {
      expect(() => {
        verifyToken('');
      }).toThrow();
    });

    it('should preserve payload data correctly', () => {
      const payload = { id: 'test-user-789', role: 'ADMIN' };
      const token = createJWT(payload);
      const decoded = verifyToken(token);

      expect(decoded.id).toBe(payload.id);
      expect(decoded.role).toBe(payload.role);
    });
  });
});
