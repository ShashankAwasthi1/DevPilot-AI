import { test } from "node:test";
import assert from "node:assert/strict";

test("cross-project isolation: each call's SQL is scoped to exactly the projectId passed in, never a different one", async (t) => {
  const capturedProjectIds: unknown[] = [];

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
    },
  });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => [Array.from({ length: 384 }, () => 0.1)],
      }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          // Record exactly which projectId this particular call was scoped
          // to (it's always the second bound value: vectorLiteral,
          // projectId, vectorLiteral, limit).
          capturedProjectIds.push(values[1]);
          return [];
        },
      },
    },
  });

  const { retrieveRelevantChunks } = await import("./document-retrieval.service");

  await retrieveRelevantChunks("u1", "project-A", "query", 5);
  await retrieveRelevantChunks("u1", "project-B", "query", 5);

  assert.deepEqual(capturedProjectIds, ["project-A", "project-B"]);
  // Neither call's bound projectId ever equals the other project - there
  // is no code path where project-A's query could be scoped to project-B.
  assert.notEqual(capturedProjectIds[0], capturedProjectIds[1]);
});
