import { test } from "node:test";
import assert from "node:assert/strict";

// Phase 26: empty-content indexing now flows through the exact same
// staleness-gated transaction as non-empty content (never a separate,
// unguarded code path) - it deletes any existing chunks, inserts none,
// and sets indexStatus to READY, all inside one transaction whose
// updatedAt re-check must pass first. This intentionally replaces the
// pre-Phase-26 assertion that "no DB transaction is needed" - that
// assertion described exactly the unguarded shortcut this phase's design
// explicitly requires closing (see the Phase 26 Step 1 design doc's A5).
const SAME_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

// "./document-indexing.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change
// the bindings a module already captured on its first import. A unique
// query string per test forces a fresh module instance, so the second
// test's own mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./document-indexing.service?test=${importCounter++}`) as Promise<
    typeof import("./document-indexing.service")
  >;
}

test("indexDocument: zero-chunk (empty) content deletes existing chunks, sets indexStatus READY, and never calls the embedding provider", async (t) => {
  let embedCalled = false;
  let transactionCalled = false;
  const deleteManyCalls: unknown[] = [];
  const statusUpdateCalls: unknown[] = [];

  const fakeTx = {
    document: {
      findUnique: async () => ({ updatedAt: SAME_UPDATED_AT }),
      update: async (args: unknown) => {
        statusUpdateCalls.push(args);
        return {};
      },
    },
    documentChunk: {
      deleteMany: async (args: unknown) => {
        deleteManyCalls.push(args);
        return { count: 3 };
      },
    },
    $executeRaw: async () => {
      throw new Error("no chunk should ever be inserted for empty content");
    },
  };

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-empty",
        projectId: "project-1",
        content: "   \n\n  ", // whitespace-only -> chunkDocument returns []
        updatedAt: SAME_UPDATED_AT,
      }),
    },
    documentChunk: {
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (callback: (tx: typeof fakeTx) => Promise<void>) => {
      transactionCalled = true;
      return callback(fakeTx);
    },
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => {
          embedCalled = true;
          return [];
        },
      }),
    },
  });

  const { indexDocument } = await import("./document-indexing.service");
  await indexDocument("doc-empty");

  assert.equal(embedCalled, false, "no embedding call should ever be made for empty content");
  assert.equal(transactionCalled, true, "empty content still runs inside the same staleness-gated transaction");

  assert.equal(deleteManyCalls.length, 1);
  assert.deepEqual(deleteManyCalls[0], { where: { documentId: "doc-empty" } });

  assert.equal(statusUpdateCalls.length, 1);
  assert.deepEqual(statusUpdateCalls[0], {
    where: { id: "doc-empty" },
    data: { indexStatus: "READY" },
  });
});

test("indexDocument: a stale empty-content indexing run deletes nothing and never touches indexStatus", async (t) => {
  const originalUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
  const laterUpdatedAt = new Date("2026-01-01T00:05:00.000Z"); // a newer edit landed mid-flight

  let deleteManyCalledInsideTransaction = false;
  let statusUpdateCalledInsideTransaction = false;

  const fakeTx = {
    document: {
      // The re-check inside the transaction sees a NEWER updatedAt than
      // what indexDocument captured before this run started.
      findUnique: async () => ({ updatedAt: laterUpdatedAt }),
      update: async () => {
        statusUpdateCalledInsideTransaction = true;
        return {};
      },
    },
    documentChunk: {
      deleteMany: async () => {
        deleteManyCalledInsideTransaction = true;
        return { count: 0 };
      },
    },
  };

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-empty",
        projectId: "project-1",
        content: "", // empty -> chunkDocument returns []
        updatedAt: originalUpdatedAt,
      }),
    },
    documentChunk: {
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (callback: (tx: typeof fakeTx) => Promise<void>) => callback(fakeTx),
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => [],
      }),
    },
  });

  const { indexDocument } = await importFreshService();
  await indexDocument("doc-empty");

  assert.equal(deleteManyCalledInsideTransaction, false, "a stale empty-content run must never delete chunks");
  assert.equal(statusUpdateCalledInsideTransaction, false, "a stale empty-content run must never touch indexStatus");
});
