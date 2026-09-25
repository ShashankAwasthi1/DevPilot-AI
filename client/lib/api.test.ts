import { test } from "node:test";
import assert from "node:assert/strict";

// Phase 23 Step 1: global 401/session-expiry handling. `redirectingToLogin`
// in api.ts is module-level state, so each test imports a FRESH copy of
// "./api" (cache-busted, same convention used throughout the server test
// suite for isolating module-level state) rather than sharing one import
// across tests - otherwise an earlier test's 401 could leave the guard
// "already redirecting" for a later, unrelated test.
//
// This file's test environment is plain Node (no jsdom/browser globals -
// see this project's existing client test setup, `tsx --test lib/*.test.ts`),
// so `window` genuinely does not exist unless a test shims it - exactly the
// scenario api.ts's own `typeof window === "undefined"` guard exists for.
// Shimming it here is a plain global assignment, not a new testing
// framework/dependency.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let importCounter = 0;
function importFreshApi() {
  return import(`./api?test=${importCounter++}`) as Promise<typeof import("./api")>;
}

// Shims `window.location.href` as a plain object with a counting setter (so
// a test can assert exactly how many times a redirect was actually
// triggered, not just its final value), and always removes the shim
// afterward so no test in this file (or, defensively, any other) can see a
// leftover global `window`.
function withWindowShim(fn: () => Promise<void> | void): Promise<{ hrefAssignCount: number }> {
  let hrefAssignCount = 0;
  let currentHref = "";
  const location = {};
  Object.defineProperty(location, "href", {
    get: () => currentHref,
    set: (value: string) => {
      hrefAssignCount += 1;
      currentHref = value;
    },
  });
  (globalThis as { window?: unknown }).window = { location };

  return Promise.resolve(fn())
    .then(() => ({ hrefAssignCount }))
    .finally(() => {
      delete (globalThis as { window?: unknown }).window;
    });
}

test("request: a 401 from a normal authenticated endpoint redirects to /login", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(401, { status: "error", message: "Session expired or invalid" }),
  );

  const { hrefAssignCount } = await withWindowShim(async () => {
    const { api, ApiError } = await importFreshApi();

    await assert.rejects(() => api.get("/projects/project-1/tasks"), ApiError);
  });

  assert.equal(hrefAssignCount, 1, "a 401 from an ordinary endpoint must redirect exactly once");
});

test("request: non-401 errors retain the existing ApiError behavior and never redirect", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { status: "error", message: "This proposal is no longer pending" }),
  );

  const { hrefAssignCount } = await withWindowShim(async () => {
    const { api, ApiError } = await importFreshApi();

    await assert.rejects(
      () => api.get("/projects/project-1/tasks"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 409);
        assert.equal(err.message, "This proposal is no longer pending");
        return true;
      },
    );
  });

  assert.equal(hrefAssignCount, 0, "a non-401 error must never trigger a redirect");
});

test("request: a 401 network failure (fetch itself throws) still throws the existing offline ApiError, with no redirect", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });

  const { hrefAssignCount } = await withWindowShim(async () => {
    const { api, ApiError } = await importFreshApi();

    await assert.rejects(
      () => api.get("/projects/project-1/tasks"),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 0);
        assert.equal(err.message, "Could not reach the server. Check your connection.");
        return true;
      },
    );
  });

  assert.equal(hrefAssignCount, 0);
});

for (const authPath of ["/auth/login", "/auth/signup", "/auth/me", "/auth/logout"]) {
  test(`request: a 401 from ${authPath} never redirects (would otherwise loop against that same auth flow)`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      jsonResponse(401, { status: "error", message: "Invalid email or password" }),
    );

    const { hrefAssignCount } = await withWindowShim(async () => {
      const { api, ApiError } = await importFreshApi();

      await assert.rejects(() => api.get(authPath), ApiError);
    });

    assert.equal(hrefAssignCount, 0, `${authPath} must never trigger the global redirect`);
  });
}

test("request: several concurrent 401 responses only trigger one redirect, never one per request", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(401, { status: "error", message: "Session expired or invalid" }),
  );

  const { hrefAssignCount } = await withWindowShim(async () => {
    const { api, ApiError } = await importFreshApi();

    const results = await Promise.allSettled([
      api.get("/projects/project-1/tasks"),
      api.get("/projects/project-1/documents"),
      api.get("/notifications"),
    ]);

    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.ok((result as PromiseRejectedResult).reason instanceof ApiError);
    }
  });

  assert.equal(hrefAssignCount, 1, "three concurrent 401s must still only redirect once");
});

test("request: a 401 with no `window` global (e.g. this test environment without the shim) never throws from the redirect path itself", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(401, { status: "error", message: "Session expired or invalid" }),
  );

  // Deliberately NOT calling withWindowShim - `window` is genuinely absent
  // here, exercising api.ts's own `typeof window === "undefined"` guard for
  // real, not just asserting it exists in the source.
  const { api, ApiError } = await importFreshApi();

  await assert.rejects(() => api.get("/projects/project-1/tasks"), ApiError);
});
