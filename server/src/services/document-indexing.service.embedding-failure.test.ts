import { test } from "node:test";
import assert from "node:assert/strict";

test("indexDocument: an embedding provider failure never touches the database - the document row is never at risk", async (t) => {
  let transactionCalled = false;
  let deleteManyCalled = false;

  const fakePrisma = {
    document: {
      findUnique: async () => ({
        id: "doc-1",
        projectId: "project-1",
        content: "Content that will need to be embedded.",
        updatedAt: new Date(),
      }),
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

  const { indexDocument } = await import("./document-indexing.service");

  await assert.rejects(() => indexDocument("doc-1"), /embedding provider unavailable/);

  // No DB write of any kind happens once the embedding call fails - the
  // document row itself was never touched by this function to begin with,
  // and no chunk table changes are attempted either.
  assert.equal(transactionCalled, false);
  assert.equal(deleteManyCalled, false);
});
