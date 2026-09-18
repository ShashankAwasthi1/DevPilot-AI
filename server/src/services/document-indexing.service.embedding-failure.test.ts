import { test } from "node:test";
import assert from "node:assert/strict";

// "./document-indexing.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change
// the bindings a module already captured on its first import (same
// module-cache constraint documented throughout this test suite). A
// unique query string per test forces a fresh module instance, so each
// test's own mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./document-indexing.service?test=${importCounter++}`) as Promise<
    typeof import("./document-indexing.service")
  >;
}

const CAPTURED_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

test("indexDocument: an embedding provider failure never touches the database - the document row is never at risk, and indexStatus is marked FAILED", async (t) => {
  let transactionCalled = false;
  let deleteManyCalled = false;
  const statusUpdateManyCalls: unknown[] = [];

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        content: "Content that will need to be embedded.",
        updatedAt: CAPTURED_UPDATED_AT,
      }),
      updateMany: async (args: unknown) => {
        statusUpdateManyCalls.push(args);
        return { count: 1 };
      },
    },
    documentChunk: {
      deleteMany: async () => {
        deleteManyCalled = true;
        return { count: 0 };
      },
    },
    $transaction: async () => {
      transactionCalled = true;
    },
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => {
          throw new Error("embedding provider unavailable (simulated)");
        },
      }),
    },
  });

  const { indexDocument } = await importFreshService();

  await assert.rejects(() => indexDocument("doc-1"), /embedding provider unavailable/);

  // No DB write of any kind happens once the embedding call fails - the
  // document row itself was never touched by this function to begin with,
  // and no chunk table changes are attempted either. Old chunks (whatever
  // they were) are therefore preserved by construction - this failure
  // path never opens the transaction that would delete them.
  assert.equal(transactionCalled, false);
  assert.equal(deleteManyCalled, false);

  // Phase 26: the guarded FAILED-status bookkeeping still runs, anchored
  // to the document's updatedAt as of when this run started.
  assert.equal(statusUpdateManyCalls.length, 1);
  assert.deepEqual(statusUpdateManyCalls[0], {
    where: { id: "doc-1", updatedAt: CAPTURED_UPDATED_AT },
    data: { indexStatus: "FAILED" },
  });
});

test("indexDocument: if the document changed since this run started, the guarded FAILED-status update affects zero rows and the original error still propagates unchanged", async (t) => {
  let statusUpdateManyCallCount = 0;

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        content: "Content that will need to be embedded.",
        updatedAt: CAPTURED_UPDATED_AT,
      }),
      // Simulates a real Postgres UPDATE ... WHERE updatedAt = $stale
      // matching zero rows because a newer edit has since landed - this
      // is not an error, just a lost race, and must never surface as one.
      updateMany: async (args: unknown) => {
        statusUpdateManyCallCount++;
        void args;
        return { count: 0 };
      },
    },
    documentChunk: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async () => {
      throw new Error("simulated transaction failure");
    },
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async (texts: string[]) => texts.map(() => Array.from({ length: 384 }, () => 1)),
      }),
    },
  });

  const { indexDocument } = await importFreshService();

  await assert.rejects(() => indexDocument("doc-1"), /simulated transaction failure/);
  assert.equal(statusUpdateManyCallCount, 1, "the guarded update is still attempted even though it matches nothing");
});

test("indexDocument: if the guarded FAILED-status bookkeeping itself throws, the original indexing error still propagates - never masked or replaced", async (t) => {
  const bookkeepingErrorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    bookkeepingErrorLogs.push(args);
  });

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        content: "Content that will need to be embedded.",
        updatedAt: CAPTURED_UPDATED_AT,
      }),
      updateMany: async () => {
        throw new Error("simulated database failure recording FAILED status");
      },
    },
    documentChunk: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async () => {},
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => {
          throw new Error("embedding provider unavailable (simulated)");
        },
      }),
    },
  });

  const { indexDocument } = await importFreshService();

  await assert.rejects(() => indexDocument("doc-1"), /embedding provider unavailable/);

  // The bookkeeping failure was logged, not swallowed silently and not
  // left to become an unhandled rejection.
  assert.equal(bookkeepingErrorLogs.length, 1);
});
