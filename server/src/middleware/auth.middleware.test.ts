import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { AppError } from "../utils/AppError";
import { SESSION_COOKIE_NAME } from "../config/auth";

// Phase 27 Step 3: auth.middleware (requireAuth) had no dedicated tests
// before this step, and no middleware test file existed anywhere in the
// repo to mirror - this follows the same t.mock.module + fake req/res/next
// pattern already established for controller tests.

function makeFakeRequest(cookieToken?: string): Request {
  return {
    cookies: cookieToken !== undefined ? { [SESSION_COOKIE_NAME]: cookieToken } : {},
  } as unknown as Request;
}

function capturingNext(): { next: (err?: unknown) => void; calls: unknown[] } {
  const calls: unknown[] = [];
  const next = (err?: unknown) => {
    calls.push(err);
  };
  return { next, calls };
}

let importCounter = 0;
function importFreshMiddleware() {
  return import(`./auth.middleware?test=${importCounter++}`) as Promise<typeof import("./auth.middleware")>;
}

const SAFE_USER = {
  id: "user-1",
  email: "person@example.com",
  name: "Person",
  avatarUrl: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("requireAuth: a missing cookie is rejected with 401 'Authentication required', and the session is never looked up", async (t) => {
  let lookupCalls = 0;
  t.mock.module("../services/auth.service", {
    namedExports: {
      getUserForSessionToken: async () => {
        lookupCalls += 1;
        return null;
      },
    },
  });

  const { requireAuth } = await importFreshMiddleware();
  const req = makeFakeRequest(undefined);
  const { next, calls } = capturingNext();

  await requireAuth(req, {} as Response, next as never);

  assert.equal(calls.length, 1);
  const err = calls[0];
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Authentication required");
  assert.equal(lookupCalls, 0);
  assert.equal(req.user, undefined);
});

test("requireAuth: an empty-string cookie is treated the same as a missing cookie", async (t) => {
  let lookupCalls = 0;
  t.mock.module("../services/auth.service", {
    namedExports: {
      getUserForSessionToken: async () => {
        lookupCalls += 1;
        return null;
      },
    },
  });

  const { requireAuth } = await importFreshMiddleware();
  const req = makeFakeRequest("");
  const { next, calls } = capturingNext();

  await requireAuth(req, {} as Response, next as never);

  assert.equal(calls.length, 1);
  const err = calls[0];
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Authentication required");
  assert.equal(lookupCalls, 0);
});

test("requireAuth: an invalid/unknown token is rejected with 401 'Session expired or invalid'", async (t) => {
  t.mock.module("../services/auth.service", {
    namedExports: {
      getUserForSessionToken: async () => null,
    },
  });

  const { requireAuth } = await importFreshMiddleware();
  const req = makeFakeRequest("some-unknown-token");
  const { next, calls } = capturingNext();

  await requireAuth(req, {} as Response, next as never);

  assert.equal(calls.length, 1);
  const err = calls[0];
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Session expired or invalid");
  assert.equal(req.user, undefined);
});

test("requireAuth: a valid token attaches the resolved user to req.user and calls next() with no error", async (t) => {
  t.mock.module("../services/auth.service", {
    namedExports: {
      getUserForSessionToken: async () => SAFE_USER,
    },
  });

  const { requireAuth } = await importFreshMiddleware();
  const req = makeFakeRequest("a-valid-token");
  const { next, calls } = capturingNext();

  await requireAuth(req, {} as Response, next as never);

  assert.deepEqual(req.user, SAFE_USER);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined, "next() must be called with no error on success");
});

test("requireAuth: a rejected/throwing getUserForSessionToken is forwarded through next(err), never thrown across the middleware boundary", async (t) => {
  const serviceError = new Error("database unavailable");
  t.mock.module("../services/auth.service", {
    namedExports: {
      getUserForSessionToken: async () => {
        throw serviceError;
      },
    },
  });

  const { requireAuth } = await importFreshMiddleware();
  const req = makeFakeRequest("some-token");
  const { next, calls } = capturingNext();

  await assert.doesNotReject(() => requireAuth(req, {} as Response, next as never));

  assert.equal(calls.length, 1);
  assert.equal(calls[0], serviceError);
  assert.equal(req.user, undefined);
});
