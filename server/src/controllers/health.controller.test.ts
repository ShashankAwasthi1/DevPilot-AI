import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeJsonResponse } from "./test-helpers";

// Phase 27 Step 5/8: health.controller had no dedicated tests before
// Step 5. Step 8 adds the real `getReadiness` database check - every test
// that calls it now mocks "../config/prisma" (never a real PrismaClient)
// so no test ever needs a live database.

let importCounter = 0;
function importFreshController() {
  return import(`./health.controller?test=${importCounter++}`) as Promise<
    typeof import("./health.controller")
  >;
}

function mockPrisma(t: import("node:test").TestContext, queryRaw: () => Promise<unknown>) {
  t.mock.module("../config/prisma", {
    namedExports: { prisma: { $queryRaw: queryRaw } },
  });
}

test("getHealth: returns 200 with a fixed, dependency-free liveness payload", async () => {
  const { getHealth } = await importFreshController();
  const { res, state } = makeFakeJsonResponse();

  getHealth({} as never, res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", service: "devpilot-api" });
});

for (const modelStatus of ["idle", "loading", "ready", "failed"] as const) {
  test(`getReadiness: with a healthy database, reports embeddingModel: "${modelStatus}" with HTTP 200 (embedding status never gates traffic)`, async (t) => {
    t.mock.module("../ai/local-embedding-provider", {
      namedExports: { getEmbeddingModelStatus: () => modelStatus },
    });
    mockPrisma(t, async () => [{ "?column?": 1 }]);

    const { getReadiness } = await importFreshController();
    const { res, state } = makeFakeJsonResponse();

    await getReadiness({} as never, res);

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.body, { status: "ok", data: { embeddingModel: modelStatus, database: "ok" } });
  });
}

test("getReadiness: a healthy database check runs a lightweight SELECT 1-equivalent query, exactly once", async (t) => {
  t.mock.module("../ai/local-embedding-provider", {
    namedExports: { getEmbeddingModelStatus: () => "ready" },
  });
  let queryCalls = 0;
  mockPrisma(t, async () => {
    queryCalls++;
    return [{ "?column?": 1 }];
  });

  const { getReadiness } = await importFreshController();
  const { res } = makeFakeJsonResponse();

  await getReadiness({} as never, res);

  assert.equal(queryCalls, 1);
});

test("getReadiness: a failing database check returns 503, regardless of embedding model status", async (t) => {
  t.mock.module("../ai/local-embedding-provider", {
    namedExports: { getEmbeddingModelStatus: () => "ready" },
  });
  mockPrisma(t, async () => {
    throw new Error("connection to server at \"db.internal.example.com\" failed: timeout expired");
  });

  const { getReadiness } = await importFreshController();
  const { res, state } = makeFakeJsonResponse();

  await getReadiness({} as never, res);

  assert.equal(state.statusCode, 503);
});

test("getReadiness: a database failure returns a safe, generic message - never the underlying Prisma error, host, or connection detail", async (t) => {
  t.mock.module("../ai/local-embedding-provider", {
    namedExports: { getEmbeddingModelStatus: () => "ready" },
  });
  mockPrisma(t, async () => {
    throw new Error("connection to server at \"db.internal.example.com\" (10.0.0.5), port 5432 failed");
  });

  const { getReadiness } = await importFreshController();
  const { res, state } = makeFakeJsonResponse();

  await getReadiness({} as never, res);

  assert.deepEqual(state.body, { status: "error", message: "Not ready: the database is unavailable." });
  const serialized = JSON.stringify(state.body);
  assert.equal(serialized.includes("db.internal.example.com"), false);
  assert.equal(serialized.includes("10.0.0.5"), false);
  assert.equal(serialized.includes("5432"), false);
});

test("getReadiness: with a healthy database, exposes only embeddingModel and database - no stack trace, path, or other internal detail", async (t) => {
  t.mock.module("../ai/local-embedding-provider", {
    namedExports: { getEmbeddingModelStatus: () => "failed" },
  });
  mockPrisma(t, async () => [{ "?column?": 1 }]);

  const { getReadiness } = await importFreshController();
  const { res, state } = makeFakeJsonResponse();

  await getReadiness({} as never, res);

  assert.deepEqual(Object.keys(state.body as Record<string, unknown>).sort(), ["data", "status"]);
  const data = (state.body as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data).sort(), ["database", "embeddingModel"]);
});
