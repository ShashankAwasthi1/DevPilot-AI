import { test } from "node:test";
import assert from "node:assert/strict";

test("indexDocument: discards a stale indexing run if the document changed while embedding was in flight", async (t) => {
  const originalUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
  const laterUpdatedAt = new Date("2026-01-01T00:05:00.000Z"); // a newer edit landed mid-flight

  let deleteManyCalledInsideTransaction = false;
  let insertCount = 0;
  let statusUpdateCalledInsideTransaction = false;

  const fakeTx = {
    document: {
      // The re-check inside the transaction sees a NEWER updatedAt than
      // what indexDocument captured before calling the embedding provider.
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
    $executeRaw: async () => {
      insertCount++;
      return 1;
    },
  };

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        content: "Some real content that will produce at least one chunk.",
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
        embed: async (texts: string[]) => texts.map(() => Array.from({ length: 384 }, () => 1)),
      }),
    },
  });

  const { indexDocument } = await import("./document-indexing.service");
  await indexDocument("doc-1");

  assert.equal(deleteManyCalledInsideTransaction, false, "a stale run must never delete the newer chunks");
  assert.equal(insertCount, 0, "a stale run must never insert now-outdated chunks");
  // Phase 26: a stale run must never touch indexStatus either - the newer
  // edit that superseded it already reset indexStatus to PENDING at save
  // time, and only that newer edit's own (still in-flight or already-
  // completed) indexing run may ever advance it from there.
  assert.equal(statusUpdateCalledInsideTransaction, false, "a stale run must never change indexStatus");
});
