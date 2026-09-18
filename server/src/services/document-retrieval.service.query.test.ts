import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LIMITS } from "../ai/limits";

// "./document-retrieval.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change
// the bindings a module already captured on its first import. A unique
// query string per test forces a fresh module instance, so each test's
// own mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./document-retrieval.service?test=${importCounter++}`) as Promise<
    typeof import("./document-retrieval.service")
  >;
}

// Phase 26 Step 5: retrieveRelevantChunks now issues TWO $queryRaw calls
// (vector, then the new lexical query) instead of one - a single shared
// mock implementation can no longer return one canned dataset for both.
// This routes by a structural marker only the lexical query's SQL text
// contains ("ILIKE"), never by call order/count (which Promise.all does
// not guarantee) and never by fragile exact-whitespace matching. Defaults
// lexicalRows to [] so these tests stay precisely about the VECTOR path,
// exactly as they were before Step 5 - hybrid fusion itself is covered by
// document-retrieval.service.rrf.test.ts and
// document-retrieval.service.hybrid.test.ts instead of being smuggled in
// here via a mock that accidentally returns the same rows for both
// queries.
function mockPrismaWithRouting(
  t: import("node:test").TestContext,
  options: {
    vectorRows?: unknown[];
    lexicalRows?: unknown[];
    onVectorQuery?: (strings: TemplateStringsArray, values: unknown[]) => void;
    onLexicalQuery?: (strings: TemplateStringsArray, values: unknown[]) => void;
  } = {},
) {
  const vectorRows = options.vectorRows ?? [];
  const lexicalRows = options.lexicalRows ?? [];

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("ILIKE")) {
            options.onLexicalQuery?.(strings, values);
            return lexicalRows;
          }
          options.onVectorQuery?.(strings, values);
          return vectorRows;
        },
      },
    },
  });
}

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
  mockPrismaWithRouting(t, {
    vectorRows: [
      {
        documentId: "doc-1",
        documentTitle: "API Authentication Guide",
        chunkId: "chunk-1",
        chunkIndex: 0,
        content: "How to authenticate against the API...",
        distance: 0.12,
      },
    ],
    onVectorQuery: (strings, values) => {
      capturedStrings = strings;
      capturedValues = values;
    },
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "how do I authenticate?", 3);

  // 1. Query text is embedded via the EmbeddingProvider abstraction.
  assert.deepEqual(embedCalledWith, ["how do I authenticate?"]);

  // 2. projectId and the SQL LIMIT are passed as bound parameters (present
  // in the `values` array captured from the tagged template - never
  // merged into the fixed SQL text in `strings`). The bound LIMIT is the
  // fixed internal candidate limit (AI_LIMITS.SEARCH_CANDIDATE_LIMIT),
  // independent of the caller's own `limit` argument (3 here) - the
  // caller's limit is applied afterward, in application code, once fusion
  // and the diversity cap have had real candidates to work with.
  assert.ok(capturedValues.includes("project-a"), "projectId must be a bound parameter");
  assert.ok(
    capturedValues.includes(AI_LIMITS.SEARCH_CANDIDATE_LIMIT),
    "the internal candidate limit, not the caller's final limit, must be the bound SQL LIMIT parameter",
  );
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

  // The relevance threshold is a structural part of the WHERE clause
  // (before LIMIT), and its value is a bound parameter, not inlined into
  // the SQL text.
  assert.match(capturedStrings!.join(""), /dc\.embedding\s*<=>.*<=/s);
  assert.ok(
    capturedValues.includes(AI_LIMITS.MAX_SEARCH_DISTANCE),
    "the relevance threshold must be a bound parameter",
  );

  // 4. The result never includes the raw embedding vector - only the
  // fields the retrieval service's return type defines. With no lexical
  // matches (lexicalRows defaults to []), this is exactly the vector
  // result, unaffected by fusion.
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

// Correction (post-Step-4 review, still true after Step 5): the SQL
// candidate LIMIT must be fixed at AI_LIMITS.SEARCH_CANDIDATE_LIMIT (20)
// always - never widened by a caller's own `limit` exceeding it. This
// uses a limit larger than 20 specifically to prove the vector query's
// SQL LIMIT does NOT grow past the approved fixed candidate budget
// (needed so 20 vector + 20 lexical = 40 total stays exact).
test("retrieval: the SQL candidate LIMIT stays fixed at AI_LIMITS.SEARCH_CANDIDATE_LIMIT even when the caller's requested limit exceeds it", async (t) => {
  let capturedVectorValues: unknown[] = [];

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
  mockPrismaWithRouting(t, {
    onVectorQuery: (_strings, values) => {
      capturedVectorValues = values;
    },
  });

  const { retrieveRelevantChunks } = await importFreshService();

  const largeLimit = AI_LIMITS.SEARCH_CANDIDATE_LIMIT + 5;
  await retrieveRelevantChunks("u1", "project-a", "query", largeLimit);

  assert.ok(
    capturedVectorValues.includes(AI_LIMITS.SEARCH_CANDIDATE_LIMIT),
    "the bound vector SQL LIMIT must be exactly SEARCH_CANDIDATE_LIMIT",
  );
  assert.ok(
    !capturedVectorValues.includes(largeLimit),
    "the caller's larger requested limit must never be used as the vector SQL LIMIT",
  );
});
