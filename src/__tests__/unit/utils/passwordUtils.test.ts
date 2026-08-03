import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../../../utils/passwordUtils.js';

describe('unit | passwordUtils', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
      expect(hashed.length).toBeGreaterThan(0);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'testpassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // Different salts
    });

    it('should handle empty password', async () => {
      const password = '';
      const hashed = await hashPassword(password);

      expect(hashed).toBeDefined();
      expect(hashed.length).toBeGreaterThan(0);
    });

    it('should handle long passwords', async () => {
      const password = 'a'.repeat(100);
      const hashed = await hashPassword(password);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
    });
  });

  describe('comparePassword', () => {
    it('should return true for correct password', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);
      const isMatch = await comparePassword(password, hashed);

      expect(isMatch).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);
      const isMatch = await comparePassword('wrongpassword', hashed);

      expect(isMatch).toBe(false);
    });

    it('should return false for empty password against hash', async () => {
      const password = 'testpassword123';
      const hashed = await hashPassword(password);
      const isMatch = await comparePassword('', hashed);

      expect(isMatch).toBe(false);
    });

    it('should handle case sensitivity', async () => {
      const password = 'TestPassword123';
      const hashed = await hashPassword(password);
      const isMatch = await comparePassword('testpassword123', hashed);

      expect(isMatch).toBe(false); // Passwords are case-sensitive
    });
  });
});
