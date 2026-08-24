import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  hashOwnerPassword,
  verifyOwnerPassword,
  createOwnerSessionToken,
  verifyOwnerSessionToken,
} from '../../../utils/ownerAuth.js';
import { createCountSessionToken } from '../../../utils/tokenUtils.js';

describe('unit | ownerAuth (owner-console auth boundary)', () => {
  beforeAll(() => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing_only';
    }
  });

  describe('hashOwnerPassword / verifyOwnerPassword', () => {
    it('round-trips a correct password', () => {
      const hash = hashOwnerPassword('correct horse battery staple');
      expect(verifyOwnerPassword('correct horse battery staple', hash)).toBe(true);
    });

    it('rejects a wrong password', () => {
      const hash = hashOwnerPassword('correct horse battery staple');
      expect(verifyOwnerPassword('wrong password', hash)).toBe(false);
    });

    it('produces a different hash each time (random salt)', () => {
      const hash1 = hashOwnerPassword('same password');
      const hash2 = hashOwnerPassword('same password');
      expect(hash1).not.toBe(hash2);
      expect(verifyOwnerPassword('same password', hash1)).toBe(true);
      expect(verifyOwnerPassword('same password', hash2)).toBe(true);
    });

    it('rejects when the stored hash is malformed (missing salt separator)', () => {
      expect(verifyOwnerPassword('anything', 'not-a-valid-hash')).toBe(false);
    });

    it('rejects when the stored hash is empty', () => {
      expect(verifyOwnerPassword('anything', '')).toBe(false);
    });

    it('rejects when the stored hash bytes are a different length than expected (corrupted/truncated hash)', () => {
      expect(verifyOwnerPassword('anything', 'somesalt:deadbeef')).toBe(false);
    });

    it('is case-sensitive', () => {
      const hash = hashOwnerPassword('Password123');
      expect(verifyOwnerPassword('password123', hash)).toBe(false);
    });
  });

  describe('createOwnerSessionToken / verifyOwnerSessionToken', () => {
    it('a freshly created owner token verifies as valid', () => {
      const token = createOwnerSessionToken();
      expect(verifyOwnerSessionToken(token)).toBe(true);
    });

    it('rejects a garbage token', () => {
      expect(verifyOwnerSessionToken('not.a.jwt')).toBe(false);
    });

    it('rejects an empty token', () => {
      expect(verifyOwnerSessionToken('')).toBe(false);
    });

    it('rejects a token signed with the wrong secret', () => {
      const forged = jwt.sign({ purpose: 'owner_session' }, 'wrong-secret', { expiresIn: '30d' });
      expect(verifyOwnerSessionToken(forged)).toBe(false);
    });

    it('rejects an expired owner token', () => {
      const expired = jwt.sign({ purpose: 'owner_session' }, process.env.JWT_SECRET!, { expiresIn: '-1s' });
      expect(verifyOwnerSessionToken(expired)).toBe(false);
    });

    it('rejects a validly-signed token that lacks the owner_session purpose', () => {
      const wrongPurpose = jwt.sign({ purpose: 'something_else' }, process.env.JWT_SECRET!, { expiresIn: '30d' });
      expect(verifyOwnerSessionToken(wrongPurpose)).toBe(false);
    });

    it('rejects a validly-signed token with no purpose claim at all', () => {
      const noPurpose = jwt.sign({ foo: 'bar' }, process.env.JWT_SECRET!, { expiresIn: '30d' });
      expect(verifyOwnerSessionToken(noPurpose)).toBe(false);
    });

    // Cross-boundary check: the magic-link (count_session) mechanism shares
    // JWT_SECRET with the owner-console mechanism. A magic-link token must
    // never be accepted as an owner token, even though both are validly
    // signed by the same secret — the "purpose" claim is the only thing
    // separating a staff member's narrow count-entry session from full
    // cross-tenant owner access.
    it('rejects a valid count_session (magic-link) token — different purpose, same secret', () => {
      const magicLinkToken = createCountSessionToken({ id: 'user-1', role: 'ADMIN', purpose: 'count_magic_link' });
      expect(verifyOwnerSessionToken(magicLinkToken)).toBe(false);
    });
  });
});
