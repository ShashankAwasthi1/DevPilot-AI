import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Router } from "express";
import { AppError } from "./utils/AppError";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Phase 27 Step 8: app.ts itself had no dedicated tests before this step.
// "./routes" is mocked with a trivial empty router so importing the real
// app.ts here never transitively constructs a real PrismaClient (every
// real route eventually reaches a controller/service that imports
// ../config/prisma) - this test genuinely exercises app.ts's own
// middleware setup (cors, json, cookieParser, trust proxy, the
// x-powered-by disable added in this step, error handlers), not the
// business logic behind any real route.

let importCounter = 0;
function importFreshApp() {
  return import(`./app?test=${importCounter++}`) as Promise<{ default: import("express").Express }>;
}

test("app: disables the X-Powered-By header on every response", async (t) => {
  t.mock.module("./routes", { defaultExport: Router() });

  const { default: app } = await importFreshApp();

  assert.equal(app.get("x-powered-by"), false, "x-powered-by must be disabled on the Express app itself");

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/does-not-exist`);
    assert.equal(res.headers.get("x-powered-by"), null, "no response may carry the X-Powered-By header");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// Phase 24 Step 1: request-id middleware is mounted before everything else
// in app.ts, so it must apply uniformly to every kind of response this app
// can send - success, 404, and both error-handler branches. Each test below
// mocks "./routes" with a router shaped for exactly the one response type
// being verified, for the same reason the test above does: importing the
// real app.ts must never transitively construct a real PrismaClient.

test("app: a successful response carries a UUID-format X-Request-ID header", async (t) => {
  const router = Router();
  router.get("/ok", (_req, res) => res.status(200).json({ status: "ok", data: null }));
  t.mock.module("./routes", { defaultExport: router });

  const { default: app } = await importFreshApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/ok`);
    const id = res.headers.get("x-request-id");
    assert.equal(res.status, 200);
    assert.ok(id, "X-Request-ID header must be present");
    assert.match(id!, UUID_PATTERN);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("app: a 404 response still carries an X-Request-ID header", async (t) => {
  t.mock.module("./routes", { defaultExport: Router() });

  const { default: app } = await importFreshApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/does-not-exist`);
    assert.equal(res.status, 404);
    const id = res.headers.get("x-request-id");
    assert.ok(id, "X-Request-ID header must be present on a 404");
    assert.match(id!, UUID_PATTERN);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("app: an AppError thrown by a route keeps its existing status/body contract and still carries an X-Request-ID header", async (t) => {
  const router = Router();
  router.get("/boom", () => {
    throw new AppError(409, "This proposal is no longer pending");
  });
  t.mock.module("./routes", { defaultExport: router });

  const { default: app } = await importFreshApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/boom`);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { status: "error", message: "This proposal is no longer pending" });
    const id = res.headers.get("x-request-id");
    assert.ok(id, "X-Request-ID header must be present on an AppError response");
    assert.match(id!, UUID_PATTERN);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("app: an unexpected error thrown by a route returns the generic 500 contract (no leaked detail) and still carries an X-Request-ID header, logged alongside the raw error", async (t) => {
  const router = Router();
  router.get("/crash", () => {
    throw new Error("column \"foo\" does not exist");
  });
  t.mock.module("./routes", { defaultExport: router });

  const logCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logCalls.push(args);
  });

  const { default: app } = await importFreshApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/crash`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { status: "error", message: "Internal server error" });
    assert.equal(JSON.stringify(body).includes("foo"), false);

    const id = res.headers.get("x-request-id");
    assert.ok(id, "X-Request-ID header must be present on a 500 response");
    assert.match(id!, UUID_PATTERN);

    assert.equal(logCalls.length, 1);
    const [prefix] = logCalls[0];
    assert.ok((prefix as string).includes(id!), "the server-side log must include the same request id sent to the client");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("app: two separate requests receive two different X-Request-ID values", async (t) => {
  const router = Router();
  router.get("/ok", (_req, res) => res.status(200).json({ status: "ok", data: null }));
  t.mock.module("./routes", { defaultExport: router });

  const { default: app } = await importFreshApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const [resA, resB] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/v1/ok`),
      fetch(`http://127.0.0.1:${port}/api/v1/ok`),
    ]);
    const idA = resA.headers.get("x-request-id");
    const idB = resB.headers.get("x-request-id");
    assert.ok(idA && idB);
    assert.notEqual(idA, idB);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
