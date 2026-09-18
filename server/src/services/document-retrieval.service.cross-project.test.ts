import { test } from "node:test";
import assert from "node:assert/strict";

test("cross-project isolation: both the vector and the lexical query are scoped to exactly the projectId passed in, never a different one", async (t) => {
  const capturedVectorProjectIds: unknown[] = [];
  const capturedLexicalProjectIds: unknown[] = [];

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
        // Phase 26 Step 5: retrieveRelevantChunks now issues TWO
        // $queryRaw calls (vector, then the new lexical query). Routed by
        // a structural marker only the lexical query's SQL text contains
        // ("ILIKE") - the vector query's projectId is always its second
        // bound value (vectorLiteral, projectId, ...); the lexical
        // query's projectId is always its first (projectId, pattern,
        // limit).
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("ILIKE")) {
            capturedLexicalProjectIds.push(values[0]);
          } else {
            capturedVectorProjectIds.push(values[1]);
          }
          return [];
        },
      },
    },
  });

  const { retrieveRelevantChunks } = await import("./document-retrieval.service");

  await retrieveRelevantChunks("u1", "project-A", "query", 5);
  await retrieveRelevantChunks("u1", "project-B", "query", 5);

  assert.deepEqual(capturedVectorProjectIds, ["project-A", "project-B"]);
  assert.deepEqual(capturedLexicalProjectIds, ["project-A", "project-B"]);
  // Neither call's bound projectId ever equals the other project - there
  // is no code path where project-A's query (vector or lexical) could be
  // scoped to project-B.
  assert.notEqual(capturedVectorProjectIds[0], capturedVectorProjectIds[1]);
  assert.notEqual(capturedLexicalProjectIds[0], capturedLexicalProjectIds[1]);
});
