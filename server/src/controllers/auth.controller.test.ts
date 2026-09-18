import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { AppError } from "../utils/AppError";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../config/auth";
import { capturingNext, makeFakeJsonResponse, throwingNext } from "./test-helpers";

// Phase 27 Step 3: auth.controller had no dedicated tests before this step.

function makeFakeRequest(options: { body?: Record<string, unknown>; cookieToken?: string | undefined; user?: unknown } = {}): Request {
  return {
    body: options.body ?? {},
    cookies: options.cookieToken !== undefined ? { [SESSION_COOKIE_NAME]: options.cookieToken } : {},
    user: options.user,
  } as unknown as Request;
}

interface CookieCall {
  name: string;
  value: string;
  options: unknown;
}

function makeFakeResponseWithCookies(): { res: Response; state: { statusCode: number | null; body: unknown }; cookieCalls: CookieCall[]; clearCookieCalls: { name: string; options: unknown }[] } {
  const { res, state } = makeFakeJsonResponse();
  const cookieCalls: CookieCall[] = [];
  const clearCookieCalls: { name: string; options: unknown }[] = [];

  (res as unknown as { cookie: (name: string, value: string, options: unknown) => Response }).cookie = (
    name: string,
    value: string,
    options: unknown,
  ) => {
    cookieCalls.push({ name, value, options });
    return res;
  };
  (res as unknown as { clearCookie: (name: string, options: unknown) => Response }).clearCookie = (
    name: string,
    options: unknown,
  ) => {
    clearCookieCalls.push({ name, options });
    return res;
  };

  return { res, state, cookieCalls, clearCookieCalls };
}

let importCounter = 0;
function importFreshController() {
  return import(`./auth.controller?test=${importCounter++}`) as Promise<typeof import("./auth.controller")>;
}

const SAFE_USER = {
  id: "user-1",
  email: "person@example.com",
  name: "Person",
  avatarUrl: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

// --- signup ----------------------------------------------------------------

test("signup: calls authService.signup with the request body, sets the session cookie, and returns 201 with { user } only", async (t) => {
  t.mock.module("../services/auth.service", {
    namedExports: {
      signup: async () => ({
        user: SAFE_USER,
        session: { token: "raw-session-token", expiresAt: new Date("2026-01-08T00:00:00.000Z") },
      }),
    },
  });

  const { signup } = await importFreshController();
  const req = makeFakeRequest({ body: { email: "person@example.com", password: "correct-horse-battery" } });
  const { res, state, cookieCalls } = makeFakeResponseWithCookies();

  await signup(req, res, throwingNext());

  assert.equal(cookieCalls.length, 1);
  assert.equal(cookieCalls[0].name, SESSION_COOKIE_NAME);
  assert.equal(cookieCalls[0].value, "raw-session-token");
  assert.deepEqual(cookieCalls[0].options, sessionCookieOptions);

  assert.equal(state.statusCode, 201);
  assert.deepEqual(state.body, { status: "ok", data: { user: SAFE_USER } });

  // The session token/expiry must never leak into the response body.
  assert.equal((state.body as { data: Record<string, unknown> }).data.session, undefined);
  assert.equal(JSON.stringify(state.body).includes("raw-session-token"), false);
});

test("signup: a service error is forwarded to next(err), and no cookie is set", async (t) => {
  const serviceError = new AppError(409, "An account with this email already exists");
  t.mock.module("../services/auth.service", {
    namedExports: {
      signup: async () => {
        throw serviceError;
      },
    },
  });

  const { signup } = await importFreshController();
  const req = makeFakeRequest({ body: { email: "person@example.com", password: "correct-horse-battery" } });
  const { res, cookieCalls } = makeFakeResponseWithCookies();
  const { next, errors } = capturingNext();

  await signup(req, res, next);

  assert.equal(errors.length, 1);
  assert.equal(errors[0], serviceError);
  assert.equal(cookieCalls.length, 0);
});

// --- login -------------------------------------------------------------------

test("login: sets the session cookie and returns 200 with { user }", async (t) => {
  t.mock.module("../services/auth.service", {
    namedExports: {
      login: async () => ({
        user: SAFE_USER,
        session: { token: "raw-session-token-2", expiresAt: new Date("2026-01-08T00:00:00.000Z") },
      }),
    },
  });

  const { login } = await importFreshController();
  const req = makeFakeRequest({ body: { email: "person@example.com", password: "correct-horse-battery" } });
  const { res, state, cookieCalls } = makeFakeResponseWithCookies();

  await login(req, res, throwingNext());

  assert.equal(cookieCalls.length, 1);
  assert.equal(cookieCalls[0].name, SESSION_COOKIE_NAME);
  assert.equal(cookieCalls[0].value, "raw-session-token-2");
  assert.deepEqual(cookieCalls[0].options, sessionCookieOptions);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: { user: SAFE_USER } });
});

test("login: a service error (invalid credentials) is forwarded to next(err), and no cookie is set", async (t) => {
  const serviceError = new AppError(401, "Invalid email or password");
  t.mock.module("../services/auth.service", {
    namedExports: {
      login: async () => {
        throw serviceError;
      },
    },
  });

  const { login } = await importFreshController();
  const req = makeFakeRequest({ body: { email: "person@example.com", password: "wrong" } });
  const { res, cookieCalls } = makeFakeResponseWithCookies();
  const { next, errors } = capturingNext();

  await login(req, res, next);

  assert.equal(errors.length, 1);
  assert.equal(errors[0], serviceError);
  assert.equal(cookieCalls.length, 0);
});

// --- logout --------------------------------------------------------------

test("logout: when a session cookie is present, revokes it and clears the cookie, returning 200", async (t) => {
  const revokeCalls: string[] = [];
  t.mock.module("../services/auth.service", {
    namedExports: {
      revokeSession: async (token: string) => {
        revokeCalls.push(token);
      },
    },
  });

  const { logout } = await importFreshController();
  const req = makeFakeRequest({ cookieToken: "raw-session-token" });
  const { res, state, clearCookieCalls } = makeFakeResponseWithCookies();

  await logout(req, res, throwingNext());

  assert.deepEqual(revokeCalls, ["raw-session-token"]);
  assert.equal(clearCookieCalls.length, 1);
  assert.equal(clearCookieCalls[0].name, SESSION_COOKIE_NAME);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: null });
});

test("logout: when no session cookie is present, revokeSession is never called, but the cookie is still cleared and 200 returned (idempotent)", async (t) => {
  const revokeCalls: string[] = [];
  t.mock.module("../services/auth.service", {
    namedExports: {
      revokeSession: async (token: string) => {
        revokeCalls.push(token);
      },
    },
  });

  const { logout } = await importFreshController();
  const req = makeFakeRequest({});
  const { res, state, clearCookieCalls } = makeFakeResponseWithCookies();

  await logout(req, res, throwingNext());

  assert.equal(revokeCalls.length, 0);
  assert.equal(clearCookieCalls.length, 1);
  assert.equal(state.statusCode, 200);
});

test("logout: an empty-string cookie value is treated the same as a missing cookie - revokeSession is never called", async (t) => {
  const revokeCalls: string[] = [];
  t.mock.module("../services/auth.service", {
    namedExports: {
      revokeSession: async (token: string) => {
        revokeCalls.push(token);
      },
    },
  });

  const { logout } = await importFreshController();
  const req = makeFakeRequest({ cookieToken: "" });
  const { res, state, clearCookieCalls } = makeFakeResponseWithCookies();

  await logout(req, res, throwingNext());

  assert.equal(revokeCalls.length, 0);
  assert.equal(clearCookieCalls.length, 1);
  assert.equal(state.statusCode, 200);
});

// --- me ----------------------------------------------------------------------

test("me: returns req.user (attached by requireAuth) as { user }", async () => {
  const { me } = await importFreshController();
  const req = makeFakeRequest({ user: SAFE_USER });
  const { res, state } = makeFakeJsonResponse();

  me(req, res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: { user: SAFE_USER } });
});
