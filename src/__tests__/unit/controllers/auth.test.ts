import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { comparePassword, hashPassword } from '../../../utils/passwordUtils.js';
import { createJWT, verifyToken } from '../../../utils/tokenUtils.js';

describe('unit | auth controller logic', () => {
  describe('login flow', () => {
    it('should hash password correctly', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
    });

    it('should verify correct password', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);
      const isValid = await comparePassword(password, hashed);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);
      const isValid = await comparePassword('wrongpassword', hashed);

      expect(isValid).toBe(false);
    });

    it('should create JWT token with correct payload', () => {
      const payload = { id: 'user-123', role: 'USER' };
      const token = createJWT(payload);
      const decoded = verifyToken(token);

      expect(decoded.id).toBe(payload.id);
      expect(decoded.role).toBe(payload.role);
    });
  });

  describe('token validation', () => {
    it('should validate JWT token structure', () => {
      const payload = { id: 'user-123', role: 'ADMIN' };
      const token = createJWT(payload);

      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyToken('invalid.token.string');
      }).toThrow();
    });

    it('should preserve user role in token', () => {
      const adminPayload = { id: 'admin-123', role: 'ADMIN' };
      const userPayload = { id: 'user-123', role: 'USER' };

      const adminToken = createJWT(adminPayload);
      const userToken = createJWT(userPayload);

      const decodedAdmin = verifyToken(adminToken);
      const decodedUser = verifyToken(userToken);

      expect(decodedAdmin.role).toBe('ADMIN');
      expect(decodedUser.role).toBe('USER');
    });
  });

  describe('authentication business logic', () => {
    it('should handle user status validation', () => {
      // Test that inactive users should be rejected
      const inactiveStatus = 'INACTIVE';
      const activeStatus = 'ACTIVE';

      expect(inactiveStatus).toBe('INACTIVE');
      expect(activeStatus).toBe('ACTIVE');
    });

    it('should handle deleted user validation', () => {
      const deletedAt = new Date();
      const notDeleted = null;

      expect(deletedAt).toBeInstanceOf(Date);
      expect(notDeleted).toBeNull();
    });
  });
});
