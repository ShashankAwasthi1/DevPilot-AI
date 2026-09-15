import { test } from "node:test";
import assert from "node:assert/strict";

test("indexDocument: zero-chunk (empty) content deletes existing chunks and never calls the embedding provider", async (t) => {
  let embedCalled = false;
  let transactionCalled = false;
  const deleteManyCalls: unknown[] = [];

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-empty",
        projectId: "project-1",
        content: "   \n\n  ", // whitespace-only -> chunkDocument returns []
        updatedAt: new Date(),
      }),
    },
    documentChunk: {
      deleteMany: async (args: unknown) => {
        deleteManyCalls.push(args);
        return { count: 3 };
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
        dimensions: 1536,
        embed: async () => {
          embedCalled = true;
          return [];
        },
      }),
    },
  });

  const { indexDocument } = await import("./document-indexing.service");
  await indexDocument("doc-empty");

  assert.equal(deleteManyCalls.length, 1);
  assert.deepEqual(deleteManyCalls[0], { where: { documentId: "doc-empty" } });
  assert.equal(embedCalled, false, "no embedding call should ever be made for empty content");
  assert.equal(transactionCalled, false, "no DB transaction is needed when there are no chunks to write");
});
