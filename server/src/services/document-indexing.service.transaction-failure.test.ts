import { test } from "node:test";
import assert from "node:assert/strict";

// Complements document-indexing.service.embedding-failure.test.ts, which
// covers a failure BEFORE the transaction ever opens (old chunks are
// trivially preserved there, since nothing touches them at all). This
// file covers the more interesting case: a failure INSIDE the
// transaction, after the old chunks have already been deleted but before
// the new ones finish inserting. A real Prisma $transaction rolls the
// whole attempt back atomically on any throw, restoring the deleted rows
// - this mock faithfully models that same commit-only-on-success
// semantic (never committing anything to the outer "database" unless the
// callback resolves) rather than "faking" a rollback by deleting rows
// after the fact, mirroring the same honest approach already used for
// pending-task-action.service.ts's own atomic-rollback test.
const CAPTURED_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

test("indexDocument: a failure partway through the transaction (after the delete, mid-insert) never commits the delete either, preserves old chunks, and still records FAILED", async (t) => {
  // Stands in for "the real document_chunks table" - only ever mutated if
  // the transaction callback resolves without throwing.
  const committedChunkStore = [{ id: "old-chunk-1" }, { id: "old-chunk-2" }];

  let transactionAttempted = false;
  const statusUpdateManyCalls: unknown[] = [];
  let insertAttempts = 0;

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        // Two paragraphs -> at least two chunks, so the second insert has
        // a chance to fail after the first one succeeds.
        content: `${"Alpha ".repeat(250)}\n\n${"Beta ".repeat(250)}`,
        updatedAt: CAPTURED_UPDATED_AT,
      }),
      updateMany: async (args: unknown) => {
        statusUpdateManyCalls.push(args);
        return { count: 1 };
      },
    },
    documentChunk: {
      // Never called directly on the outer client for this scenario -
      // only the transaction's own tx.documentChunk.deleteMany is
      // exercised, exactly like the real code path.
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      transactionAttempted = true;
      const pendingDeletes: unknown[] = [];
      const pendingInserts: unknown[] = [];

      const tx = {
        document: {
          findUnique: async () => ({ updatedAt: CAPTURED_UPDATED_AT }),
        },
        documentChunk: {
          deleteMany: async (args: unknown) => {
            pendingDeletes.push(args);
            return { count: committedChunkStore.length };
          },
        },
        $executeRaw: async () => {
          insertAttempts++;
          if (insertAttempts === 2) {
            throw new Error("simulated database failure inserting chunk #2");
          }
          pendingInserts.push({ index: insertAttempts });
          return 1;
        },
      };

      // The callback throwing here is exactly what a real Prisma
      // $transaction does on any error inside it - reject the whole
      // attempt, which is what causes Postgres to roll everything back.
      // Nothing pending (deletes or inserts) is ever merged into
      // committedChunkStore unless this resolves.
      await callback(tx);
      committedChunkStore.length = 0;
      committedChunkStore.push(...(pendingInserts as { id: string }[]));
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

  const { indexDocument } = await import("./document-indexing.service");

  await assert.rejects(() => indexDocument("doc-1"), /simulated database failure inserting chunk #2/);

  assert.equal(transactionAttempted, true);
  assert.ok(insertAttempts >= 2, "the failure must happen mid-insert, after at least one successful insert attempt");

  // The old chunks are exactly as they were before this run - the
  // in-transaction delete never committed, because the transaction itself
  // never resolved successfully.
  assert.deepEqual(committedChunkStore, [{ id: "old-chunk-1" }, { id: "old-chunk-2" }]);

  // The failure is still recorded via the same guarded, independent
  // bookkeeping write used for a pre-transaction failure.
  assert.equal(statusUpdateManyCalls.length, 1);
  assert.deepEqual(statusUpdateManyCalls[0], {
    where: { id: "doc-1", updatedAt: CAPTURED_UPDATED_AT },
    data: { indexStatus: "FAILED" },
  });
});
