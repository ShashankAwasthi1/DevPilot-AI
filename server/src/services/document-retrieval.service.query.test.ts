import { test } from "node:test";
import assert from "node:assert/strict";

test("retrieval: embeds the query, filters/limits correctly, uses parameterized SQL, never returns the embedding", async (t) => {
  let embedCalledWith: string[] | undefined;
  let capturedStrings: TemplateStringsArray | undefined;
  let capturedValues: unknown[] = [];

  const fakeEmbedding = Array.from({ length: 384 }, (_, i) => (i === 0 ? 0.5 : 0));

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
        embed: async (texts: string[]) => {
          embedCalledWith = texts;
          return [fakeEmbedding];
        },
      }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          capturedStrings = strings;
          capturedValues = values;
          return [
            {
              documentId: "doc-1",
              documentTitle: "API Authentication Guide",
              chunkId: "chunk-1",
              chunkIndex: 0,
              content: "How to authenticate against the API...",
              distance: 0.12,
            },
          ];
        },
      },
    },
  });

  const { retrieveRelevantChunks } = await import("./document-retrieval.service");
  const results = await retrieveRelevantChunks("u1", "project-a", "how do I authenticate?", 3);

  // 1. Query text is embedded via the EmbeddingProvider abstraction.
  assert.deepEqual(embedCalledWith, ["how do I authenticate?"]);

  // 2. projectId and limit are passed as bound parameters (present in the
  // `values` array captured from the tagged template - never merged into
  // the fixed SQL text in `strings`).
  assert.ok(capturedValues.includes("project-a"), "projectId must be a bound parameter");
  assert.ok(capturedValues.includes(3), "limit must be a bound parameter");
  assert.equal(
    capturedStrings!.join("").includes("project-a"),
    false,
    "projectId must never appear inlined in the fixed SQL text",
  );

  // The query embedding (as its vector-literal string) must also be a
  // bound parameter, appearing in `values`, not string-concatenated into
  // the SQL text.
  const vectorLiteral = `[${fakeEmbedding.join(",")}]`;
  assert.ok(capturedValues.includes(vectorLiteral), "the query embedding must be a bound parameter");
  assert.equal(capturedStrings!.join("").includes("0.5"), false);

  // 3. The SQL text filters by projectId (structurally, not just via the
  // bound value existing somewhere).
  assert.match(capturedStrings!.join(""), /WHERE\s+dc\."projectId"\s*=/);

  // 4. The result never includes the raw embedding vector - only the
  // fields the retrieval service's return type defines.
  assert.equal(results.length, 1);
  assert.deepEqual(Object.keys(results[0]).sort(), [
    "chunkId",
    "chunkIndex",
    "content",
    "distance",
    "documentId",
    "documentTitle",
  ]);
});
