import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

// Phase 27 Step 4: rate-limit.ts had no tests before this step. These tests
// exercise the real express-rate-limit middleware end-to-end (no mocking of
// the library itself) against minimal, hand-built fake req/res objects -
// just enough surface for express-rate-limit's default IP-based
// keyGenerator (request.ip/headers/socket/app.get("trust proxy")) and its
// draft-6 standard-header/Retry-After logic to run for real.
//
// Each test imports a FRESH copy of "./rate-limit" (cache-busted, same
// convention used throughout the codebase for t.mock.module isolation) so
// every test gets its own brand-new limiter instances with their own
// brand-new in-memory stores - no counters ever leak between tests.
//
// Time is advanced via node:test's built-in `t.mock.timers` (enabled with
// apis: ["Date"]) rather than any real sleep/setTimeout - express-rate-limit's
// MemoryStore computes window expiry by comparing Date.now() to a stored
// resetTime (see node_modules/express-rate-limit's MemoryStore#increment),
// so mocking Date alone is sufficient to deterministically fast-forward a
// window with zero real wall-clock delay and zero flakiness.

let importCounter = 0;
function importFreshRateLimit() {
  return import(`./rate-limit?test=${importCounter++}`) as Promise<typeof import("./rate-limit")>;
}

function makeFakeIpRequest(ip: string, headers: Record<string, string> = {}): Request {
  return {
    ip,
    headers,
    socket: { remoteAddress: ip },
    // trust proxy = 1, matching app.ts - never `true` (express-rate-limit
    // itself refuses to run behind a permissive `true` trust-proxy setting).
    app: { get: (key: string) => (key === "trust proxy" ? 1 : undefined) },
  } as unknown as Request;
}

function makeFakeUserRequest(userId: string | undefined, ip: string): Request {
  return {
    ...makeFakeIpRequest(ip),
    user: userId === undefined ? undefined : { id: userId },
  } as unknown as Request;
}

interface FakeResponseState {
  statusCode: number | null;
  body: unknown;
  sent: boolean;
  headers: Record<string, string>;
}

function makeFakeResponse(): { res: Response; state: FakeResponseState } {
  const state: FakeResponseState = { statusCode: null, body: undefined, sent: false, headers: {} };

  const res = {
    get headersSent() {
      return state.sent;
    },
    setHeader: (name: string, value: string) => {
      state.headers[name] = value;
      return res;
    },
    getHeader: (name: string) => state.headers[name],
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    send: (body: unknown) => {
      state.body = body;
      state.sent = true;
      return res;
    },
    once: () => res,
  } as unknown as Response;

  return { res, state };
}

function capturingNext(): { next: (err?: unknown) => void; calls: unknown[] } {
  const calls: unknown[] = [];
  const next = (err?: unknown) => {
    calls.push(err);
  };
  return { next, calls };
}

const RATE_LIMIT_ERROR_BODY = {
  status: "error",
  message: "Too many requests. Please try again later.",
};

// --- signup/login: below-limit and over-limit behavior ---------------------

test("loginLimiter: requests below the limit all call next() with no error, and no 429 is ever sent", async () => {
  const { loginLimiter } = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.1");

  for (let i = 0; i < 9; i++) {
    const { res, state } = makeFakeResponse();
    const { next, calls } = capturingNext();
    await loginLimiter(req, res, next);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined, `request ${i + 1} must call next() with no error`);
    assert.equal(state.sent, false);
  }
});

test("loginLimiter: the request exceeding the limit (10/15min) receives a 429, matching the app's JSON error envelope", async () => {
  const { loginLimiter } = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.2");

  let lastState: FakeResponseState | undefined;
  for (let i = 0; i < 11; i++) {
    const { res, state } = makeFakeResponse();
    const { next } = capturingNext();
    await loginLimiter(req, res, next);
    lastState = state;
  }

  assert.equal(lastState?.statusCode, 429);
  assert.deepEqual(lastState?.body, RATE_LIMIT_ERROR_BODY);
});

test("signupLimiter: the request exceeding the limit (5/15min) receives a 429 with the same JSON error envelope", async () => {
  const { signupLimiter } = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.3");

  let lastState: FakeResponseState | undefined;
  for (let i = 0; i < 6; i++) {
    const { res, state } = makeFakeResponse();
    const { next } = capturingNext();
    await signupLimiter(req, res, next);
    lastState = state;
  }

  assert.equal(lastState?.statusCode, 429);
  assert.deepEqual(lastState?.body, RATE_LIMIT_ERROR_BODY);
});

test("loginLimiter: a 429 response includes a numeric Retry-After header", async () => {
  const { loginLimiter } = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.4");

  let lastState: FakeResponseState | undefined;
  for (let i = 0; i < 11; i++) {
    const { res, state } = makeFakeResponse();
    const { next } = capturingNext();
    await loginLimiter(req, res, next);
    lastState = state;
  }

  const retryAfter = lastState?.headers["Retry-After"];
  assert.ok(retryAfter, "Retry-After header must be set on a 429 response");
  assert.ok(Number(retryAfter) > 0, "Retry-After must be a positive number of seconds");
});

test("loginLimiter: the window resets after the configured 15-minute duration, allowing requests again", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });

  const { loginLimiter } = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.5");

  // Exhaust the limit.
  for (let i = 0; i < 10; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await loginLimiter(req, res, next);
  }
  const { res: blockedRes, state: blockedState } = makeFakeResponse();
  const { next: blockedNext } = capturingNext();
  await loginLimiter(req, blockedRes, blockedNext);
  assert.equal(blockedState.statusCode, 429, "the limit must actually be exhausted before advancing time");

  // Advance past the 15-minute window - no real waiting, no flakiness.
  t.mock.timers.tick(15 * 60 * 1000 + 1);

  const { res: freshRes, state: freshState } = makeFakeResponse();
  const { next: freshNext, calls } = capturingNext();
  await loginLimiter(req, freshRes, freshNext);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined, "next() must be called with no error once the window has reset");
  assert.equal(freshState.sent, false);
});

// --- IP isolation ------------------------------------------------------------

test("loginLimiter: different req.ip values are isolated into independent buckets", async () => {
  const { loginLimiter } = await importFreshRateLimit();
  const reqA = makeFakeIpRequest("203.0.113.10");
  const reqB = makeFakeIpRequest("203.0.113.20");

  // Exhaust client A's budget entirely.
  for (let i = 0; i < 11; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await loginLimiter(reqA, res, next);
  }
  const { res: aRes, state: aState } = makeFakeResponse();
  await loginLimiter(reqA, aRes, capturingNext().next);
  assert.equal(aState.statusCode, 429, "client A must be blocked after exceeding its own limit");

  // Client B, a different IP, must be entirely unaffected.
  const { res: bRes, state: bState } = makeFakeResponse();
  const { next: bNext, calls: bCalls } = capturingNext();
  await loginLimiter(reqB, bRes, bNext);
  assert.equal(bCalls[0], undefined, "a different IP must not share client A's exhausted bucket");
  assert.equal(bState.sent, false);
});

// --- AI limiter: user-keyed, not IP-keyed -----------------------------------

test("aiChatLimiter: different req.user.id values are isolated into independent buckets, even from the identical req.ip", async () => {
  const { aiChatLimiter } = await importFreshRateLimit();
  const sameIp = "198.51.100.1";
  const reqUserA = makeFakeUserRequest("user-a", sameIp);
  const reqUserB = makeFakeUserRequest("user-b", sameIp);

  // Exhaust user A's budget (20/5min) while sharing an IP with user B.
  for (let i = 0; i < 21; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await aiChatLimiter(reqUserA, res, next);
  }
  const { res: aRes, state: aState } = makeFakeResponse();
  await aiChatLimiter(reqUserA, aRes, capturingNext().next);
  assert.equal(aState.statusCode, 429, "user A must be blocked after exceeding their own limit");

  // User B, same IP, must be entirely unaffected - proves keying is by
  // user id, not IP.
  const { res: bRes, state: bState } = makeFakeResponse();
  const { next: bNext, calls: bCalls } = capturingNext();
  await aiChatLimiter(reqUserB, bRes, bNext);
  assert.equal(bCalls[0], undefined, "a different user id must not share user A's exhausted bucket");
  assert.equal(bState.sent, false);
});

test("aiChatLimiter: the same req.user.id shares one bucket across different req.ip values", async () => {
  const { aiChatLimiter } = await importFreshRateLimit();
  const reqFromIpOne = makeFakeUserRequest("user-c", "198.51.100.10");
  const reqFromIpTwo = makeFakeUserRequest("user-c", "198.51.100.20");

  // Exhaust user C's budget while making calls from the first IP.
  for (let i = 0; i < 20; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await aiChatLimiter(reqFromIpOne, res, next);
  }

  // The 21st request for the SAME user, now from a DIFFERENT IP, must
  // still be blocked - proves the bucket travels with the user, not the IP.
  const { res, state } = makeFakeResponse();
  const { next } = capturingNext();
  await aiChatLimiter(reqFromIpTwo, res, next);

  assert.equal(state.statusCode, 429, "the same user id must share one bucket regardless of IP");
});

test("aiChatLimiter: reads the authenticated req.user.id, and never silently falls back to IP when req.user is missing", async () => {
  const { aiChatLimiter } = await importFreshRateLimit();
  // requireAuth is guaranteed to run first in the real route (see
  // conversation.routes.ts) - a missing req.user here represents a
  // middleware-ordering bug, and must surface as an error via next(err),
  // never silently degrade to rate-limiting by IP instead.
  const reqWithNoUser = makeFakeUserRequest(undefined, "198.51.100.99");

  const { res } = makeFakeResponse();
  const { next, calls } = capturingNext();
  await aiChatLimiter(reqWithNoUser, res, next);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error, "a missing req.user must be forwarded as an error, not silently handled");
});

// --- apiLimiter: general authenticated-API traffic, user-keyed -------------

test("apiLimiter: requests below the limit (200/15min) all call next() with no error", async () => {
  const { apiLimiter } = await importFreshRateLimit();
  const req = makeFakeUserRequest("user-d", "198.51.100.30");

  for (let i = 0; i < 199; i++) {
    const { res, state } = makeFakeResponse();
    const { next, calls } = capturingNext();
    await apiLimiter(req, res, next);
    assert.equal(calls[0], undefined, `request ${i + 1} must call next() with no error`);
    assert.equal(state.sent, false);
  }
});

test("apiLimiter: the request exceeding the limit (200/15min) receives a 429 with the same JSON error envelope", async () => {
  const { apiLimiter } = await importFreshRateLimit();
  const req = makeFakeUserRequest("user-e", "198.51.100.31");

  let lastState: FakeResponseState | undefined;
  for (let i = 0; i < 201; i++) {
    const { res, state } = makeFakeResponse();
    const { next } = capturingNext();
    await apiLimiter(req, res, next);
    lastState = state;
  }

  assert.equal(lastState?.statusCode, 429);
  assert.deepEqual(lastState?.body, RATE_LIMIT_ERROR_BODY);
});

test("apiLimiter: different req.user.id values are isolated into independent buckets, even from the identical req.ip", async () => {
  const { apiLimiter } = await importFreshRateLimit();
  const sameIp = "198.51.100.32";
  const reqUserA = makeFakeUserRequest("user-f", sameIp);
  const reqUserB = makeFakeUserRequest("user-g", sameIp);

  for (let i = 0; i < 201; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await apiLimiter(reqUserA, res, next);
  }
  const { res: aRes, state: aState } = makeFakeResponse();
  await apiLimiter(reqUserA, aRes, capturingNext().next);
  assert.equal(aState.statusCode, 429, "user A must be blocked after exceeding their own limit");

  const { res: bRes, state: bState } = makeFakeResponse();
  const { next: bNext, calls: bCalls } = capturingNext();
  await apiLimiter(reqUserB, bRes, bNext);
  assert.equal(bCalls[0], undefined, "a different user id must not share user A's exhausted bucket");
  assert.equal(bState.sent, false);
});

test("apiLimiter: reads the authenticated req.user.id, and never silently falls back to IP when req.user is missing", async () => {
  const { apiLimiter } = await importFreshRateLimit();
  // requireAuth is guaranteed to run first on every route apiLimiter is
  // mounted on (see project.routes.ts/task.routes.ts/etc.) - a missing
  // req.user here represents a middleware-ordering bug, and must surface
  // as an error via next(err), never silently degrade to IP-keying,
  // matching aiChatLimiter's own documented convention above.
  const reqWithNoUser = makeFakeUserRequest(undefined, "198.51.100.33");

  const { res } = makeFakeResponse();
  const { next, calls } = capturingNext();
  await apiLimiter(reqWithNoUser, res, next);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error, "a missing req.user must be forwarded as an error, not silently handled");
});

// --- conversationCreationLimiter: user-keyed, additive on top of apiLimiter --

test("conversationCreationLimiter: requests below the limit (30/15min) all call next() with no error", async () => {
  const { conversationCreationLimiter } = await importFreshRateLimit();
  const req = makeFakeUserRequest("user-h", "198.51.100.40");

  for (let i = 0; i < 29; i++) {
    const { res, state } = makeFakeResponse();
    const { next, calls } = capturingNext();
    await conversationCreationLimiter(req, res, next);
    assert.equal(calls[0], undefined, `request ${i + 1} must call next() with no error`);
    assert.equal(state.sent, false);
  }
});

test("conversationCreationLimiter: the request exceeding the limit (30/15min) receives a 429 with the same JSON error envelope", async () => {
  const { conversationCreationLimiter } = await importFreshRateLimit();
  const req = makeFakeUserRequest("user-i", "198.51.100.41");

  let lastState: FakeResponseState | undefined;
  for (let i = 0; i < 31; i++) {
    const { res, state } = makeFakeResponse();
    const { next } = capturingNext();
    await conversationCreationLimiter(req, res, next);
    lastState = state;
  }

  assert.equal(lastState?.statusCode, 429);
  assert.deepEqual(lastState?.body, RATE_LIMIT_ERROR_BODY);
});

test("conversationCreationLimiter: different req.user.id values are isolated into independent buckets, even from the identical req.ip", async () => {
  const { conversationCreationLimiter } = await importFreshRateLimit();
  const sameIp = "198.51.100.42";
  const reqUserA = makeFakeUserRequest("user-j", sameIp);
  const reqUserB = makeFakeUserRequest("user-k", sameIp);

  for (let i = 0; i < 31; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await conversationCreationLimiter(reqUserA, res, next);
  }
  const { res: aRes, state: aState } = makeFakeResponse();
  await conversationCreationLimiter(reqUserA, aRes, capturingNext().next);
  assert.equal(aState.statusCode, 429, "user A must be blocked after exceeding their own limit");

  const { res: bRes, state: bState } = makeFakeResponse();
  const { next: bNext, calls: bCalls } = capturingNext();
  await conversationCreationLimiter(reqUserB, bRes, bNext);
  assert.equal(bCalls[0], undefined, "a different user id must not share user A's exhausted bucket");
  assert.equal(bState.sent, false);
});

test("conversationCreationLimiter: reads the authenticated req.user.id, and never silently falls back to IP when req.user is missing", async () => {
  const { conversationCreationLimiter } = await importFreshRateLimit();
  // requireAuth is guaranteed to run first on this route (see
  // conversation.routes.ts) - a missing req.user here represents a
  // middleware-ordering bug, and must surface as an error via next(err),
  // never silently degrade to IP-keying, matching apiLimiter/aiChatLimiter's
  // own documented convention above.
  const reqWithNoUser = makeFakeUserRequest(undefined, "198.51.100.43");

  const { res } = makeFakeResponse();
  const { next, calls } = capturingNext();
  await conversationCreationLimiter(reqWithNoUser, res, next);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error, "a missing req.user must be forwarded as an error, not silently handled");
});

// --- fresh instance per test -------------------------------------------------

test("importing a fresh copy of the module yields brand-new limiter instances with no shared state", async () => {
  const first = await importFreshRateLimit();
  const second = await importFreshRateLimit();
  const req = makeFakeIpRequest("203.0.113.99");

  // Exhaust the FIRST module instance's loginLimiter entirely.
  for (let i = 0; i < 11; i++) {
    const { res } = makeFakeResponse();
    const { next } = capturingNext();
    await first.loginLimiter(req, res, next);
  }
  const { res: firstRes, state: firstState } = makeFakeResponse();
  await first.loginLimiter(req, firstRes, capturingNext().next);
  assert.equal(firstState.statusCode, 429);

  // The SECOND, freshly-imported module's loginLimiter, hit with the exact
  // same IP, must have its own independent (unexhausted) store.
  const { res: secondRes, state: secondState } = makeFakeResponse();
  const { next: secondNext, calls: secondCalls } = capturingNext();
  await second.loginLimiter(req, secondRes, secondNext);
  assert.equal(secondCalls[0], undefined, "a fresh module import must not inherit the previous instance's exhausted bucket");
  assert.equal(secondState.sent, false);
});
