import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { createContext } from '../../../server/context.js';
import {
  t,
  adminProcedure,
  authedProcedure,
  strictAdminProcedure,
  ownerProcedure,
  adminMutation,
  authedMutation,
} from '../../../server/trpc.js';

type Ctx = Awaited<ReturnType<typeof createContext>>;

// Exposes each real, exported procedure builder as a trivial passthrough
// so the actual middleware chain runs via tRPC's own caller factory,
// rather than re-implementing the permission checks in the test (the
// shadow-test anti-pattern found elsewhere in this suite).
const testRouter = t.router({
  admin: adminProcedure.query(() => 'ok'),
  authed: authedProcedure.query(() => 'ok'),
  strictAdmin: strictAdminProcedure.query(() => 'ok'),
  owner: ownerProcedure.query(() => 'ok'),
  adminMut: adminMutation.mutation(() => 'ok'),
  authedMut: authedMutation.mutation(() => 'ok'),
  throwsRaw: t.procedure.query(() => {
    throw new Error('relation "user" column "ssn" does not exist — raw pg error');
  }),
  throwsIntentional: t.procedure.query(() => {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  }),
});

const createCaller = t.createCallerFactory(testRouter);

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    req: {} as Ctx['req'],
    res: {} as Ctx['res'],
    db: {} as Ctx['db'],
    user: null,
    userLocationId: null,
    tenantId: null,
    isDemoTenant: false,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: false,
    ...overrides,
  };
}

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(TRPCError);
  await expect(promise).rejects.toMatchObject({ code: 'FORBIDDEN' });
}

async function expectUnauthorized(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
}

describe('unit | trpc.ts procedure gates', () => {
  describe('authedProcedure', () => {
    it('rejects with UNAUTHORIZED when ctx.user is null', async () => {
      const caller = createCaller(makeCtx());
      await expectUnauthorized(caller.authed());
    });

    it('succeeds for any authenticated role', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'USER' } }));
      await expect(caller.authed()).resolves.toBe('ok');
    });
  });

  describe('adminProcedure ("elevated" — ADMIN or MANAGER, despite the name)', () => {
    it('rejects an unauthenticated caller', async () => {
      const caller = createCaller(makeCtx());
      await expectForbidden(caller.admin());
    });

    it('rejects a plain USER', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'USER' } }));
      await expectForbidden(caller.admin());
    });

    it('allows MANAGER', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'MANAGER' } }));
      await expect(caller.admin()).resolves.toBe('ok');
    });

    it('allows ADMIN', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'ADMIN' } }));
      await expect(caller.admin()).resolves.toBe('ok');
    });
  });

  describe('strictAdminProcedure (ADMIN only — excludes MANAGER)', () => {
    it('rejects MANAGER', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'MANAGER' } }));
      await expectForbidden(caller.strictAdmin());
    });

    it('allows ADMIN', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'ADMIN' } }));
      await expect(caller.strictAdmin()).resolves.toBe('ok');
    });
  });

  describe('ownerProcedure (independent of ctx.user/tenant entirely)', () => {
    it('rejects when isOwner is false, even for a tenant ADMIN', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'ADMIN' }, isOwner: false }));
      await expectForbidden(caller.owner());
    });

    it('allows when isOwner is true, even with no tenant user at all', async () => {
      const caller = createCaller(makeCtx({ user: null, tenantId: null, isOwner: true }));
      await expect(caller.owner()).resolves.toBe('ok');
    });
  });

  describe('adminMutation (elevated role + demo-tenant guard, in that order)', () => {
    it('rejects a non-elevated user before ever checking demo status', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'USER' }, isDemoTenant: true }));
      await expectForbidden(caller.adminMut());
    });

    it('rejects an elevated user on a demo tenant', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'ADMIN' }, isDemoTenant: true }));
      await expectForbidden(caller.adminMut());
    });

    it('allows an elevated user on a non-demo tenant', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'ADMIN' }, isDemoTenant: false }));
      await expect(caller.adminMut()).resolves.toBe('ok');
    });
  });

  describe('authedMutation (auth + demo-tenant guard)', () => {
    it('rejects an unauthenticated caller with UNAUTHORIZED (not FORBIDDEN)', async () => {
      const caller = createCaller(makeCtx({ isDemoTenant: true }));
      await expectUnauthorized(caller.authedMut());
    });

    it('rejects an authenticated user on a demo tenant', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'USER' }, isDemoTenant: true }));
      await expectForbidden(caller.authedMut());
    });

    it('allows an authenticated user on a non-demo tenant', async () => {
      const caller = createCaller(makeCtx({ user: { id: 'u1', role: 'USER' }, isDemoTenant: false }));
      await expect(caller.authedMut()).resolves.toBe('ok');
    });
  });

  // errorFormatter only runs when a procedure is invoked over the wire (the
  // Express adapter) — a direct createCallerFactory() call, used by every
  // other test in this file, bypasses it entirely and throws the raw
  // TRPCError object. So this one block needs a real HTTP round-trip
  // through the exact adapter production uses (index.ts) to actually
  // exercise the formatter instead of silently testing the wrong path.
  describe('errorFormatter (scrubs unhandled errors, passes through intentional ones — over real HTTP)', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      const app = express();
      app.use('/trpc', createExpressMiddleware({ router: testRouter, createContext: async () => makeCtx() }));
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
      });
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://localhost:${port}/trpc`;
    });

    afterAll(() => {
      server.close();
    });

    it('replaces an unhandled (non-TRPCError) exception with a generic message — never leaks the raw error', async () => {
      const res = await fetch(`${baseUrl}/throwsRaw`);
      const body = (await res.json()) as { error: { message: string; code: number } };

      expect(body.error.message).toBe('An unexpected error occurred. Please try again or contact support.');
      expect(body.error.message).not.toContain('relation');
      expect(body.error.message).not.toContain('ssn');
    });

    it('leaves an intentional TRPCError (e.g. NOT_FOUND) message untouched', async () => {
      const res = await fetch(`${baseUrl}/throwsIntentional`);
      const body = (await res.json()) as { error: { message: string } };

      expect(body.error.message).toBe('Product not found');
    });
  });
});
