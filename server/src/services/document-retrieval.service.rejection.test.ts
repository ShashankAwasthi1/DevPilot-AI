import { test } from "node:test";
import assert from "node:assert/strict";

test("unauthorized project access is rejected before any embedding/query cost is incurred", async (t) => {
  let embedCalled = false;
  let queryRawCalled = false;

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => {
        throw new Error("Project not found");
      },
    },
  });
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
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async () => {
          queryRawCalled = true;
          return [];
        },
      },
    },
  });

  const { retrieveRelevantChunks } = await import("./document-retrieval.service");

  await assert.rejects(() => retrieveRelevantChunks("u1", "not-my-project", "hello", 5));
  assert.equal(embedCalled, false, "the embedding provider must never be called for an unauthorized project");
  assert.equal(queryRawCalled, false, "the database must never be queried for an unauthorized project");
});
