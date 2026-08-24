import { describe, it, expect, beforeAll } from 'vitest';
import type { Request } from 'express';
import { resolveOwnerContext } from '../../../utils/resolveOwnerContext.js';
import { createOwnerSessionToken } from '../../../utils/ownerAuth.js';
import { createCountSessionToken } from '../../../utils/tokenUtils.js';

function fakeRequest(headers: Record<string, string | string[] | undefined>): Request {
  return { headers } as unknown as Request;
}

describe('unit | resolveOwnerContext (owner-console request gate)', () => {
  beforeAll(() => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing_only';
    }
  });

  it('returns false when the x-owner-token header is absent', () => {
    expect(resolveOwnerContext(fakeRequest({}))).toBe(false);
  });

  it('returns true for a valid owner session token', () => {
    const token = createOwnerSessionToken();
    expect(resolveOwnerContext(fakeRequest({ 'x-owner-token': token }))).toBe(true);
  });

  it('returns false for a garbage token', () => {
    expect(resolveOwnerContext(fakeRequest({ 'x-owner-token': 'garbage' }))).toBe(false);
  });

  it('returns false for an empty-string header', () => {
    expect(resolveOwnerContext(fakeRequest({ 'x-owner-token': '' }))).toBe(false);
  });

  it('takes the first value when the header arrives as an array', () => {
    const token = createOwnerSessionToken();
    expect(resolveOwnerContext(fakeRequest({ 'x-owner-token': [token, 'second-value'] }))).toBe(true);
  });

  // The whole point of this middleware: a legitimate, currently-valid
  // session for a completely different purpose (a tenant staff member's
  // count-entry magic link) must never be mistaken for owner access just
  // because it's a well-formed, correctly-signed JWT.
  it('rejects a valid magic-link (count_session) token presented as an owner token', () => {
    const magicLinkToken = createCountSessionToken({ id: 'user-1', role: 'ADMIN', purpose: 'count_magic_link' });
    expect(resolveOwnerContext(fakeRequest({ 'x-owner-token': magicLinkToken }))).toBe(false);
  });
});
