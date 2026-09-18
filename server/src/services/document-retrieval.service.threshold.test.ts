import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LIMITS } from "../ai/limits";
import type { RetrievedChunk } from "./document-retrieval.service";

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

// Phase 26 Step 4: the relevance threshold is applied in the SQL WHERE
// clause itself, before LIMIT - so from this service function's own
// perspective, a below-threshold row simply never comes back from
// $queryRaw at all. These tests exercise that boundary by controlling
// exactly what the mocked vector query returns for a given bound
// threshold value, proving the service passes the threshold through
// correctly and handles both edges (included at the boundary, excluded
// above it) without ever re-filtering by distance itself in application
// code (there is nothing to re-filter - SQL already did it).
//
// Phase 26 Step 5: retrieveRelevantChunks now also issues a lexical
// $queryRaw call. Routed by a structural marker only the lexical query's
// SQL text contains ("ILIKE"); lexicalRows defaults to [] so these tests
// stay precisely about the VECTOR threshold, unconfounded by hybrid
// fusion (covered separately by document-retrieval.service.rrf.test.ts
// and document-retrieval.service.hybrid.test.ts).
function mockModules(
  t: import("node:test").TestContext,
  vectorRows: { documentId: string; documentTitle: string; chunkId: string; chunkIndex: number; content: string; distance: number }[],
) {
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
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("ILIKE")) {
            return [];
          }
          capturedVectorValues = values;
          return vectorRows;
        },
      },
    },
  });

  return { capturedValues: () => capturedVectorValues };
}

test("retrieveRelevantChunks: passes AI_LIMITS.MAX_SEARCH_DISTANCE as a bound threshold parameter to the vector SQL query", async (t) => {
  const spies = mockModules(t, []);
  const { retrieveRelevantChunks } = await importFreshService();

  await retrieveRelevantChunks("u1", "project-a", "how do I authenticate?", 5);

  assert.ok(spies.capturedValues().includes(AI_LIMITS.MAX_SEARCH_DISTANCE));
});

test("retrieveRelevantChunks: a chunk at exactly the threshold (distance === MAX_SEARCH_DISTANCE) is returned - the boundary is inclusive", async (t) => {
  mockModules(t, [
    {
      documentId: "doc-1",
      documentTitle: "Doc",
      chunkId: "chunk-1",
      chunkIndex: 0,
      content: "borderline relevance",
      distance: AI_LIMITS.MAX_SEARCH_DISTANCE,
    },
  ]);

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 5);

  // SQL itself is the sole enforcer of the threshold (WHERE ... <= X) -
  // this test proves the service doesn't ALSO re-filter and accidentally
  // drop a boundary row that the (mocked) database already decided to
  // include.
  assert.equal(results.length, 1);
  assert.equal(results[0].chunkId, "chunk-1");
});

test("retrieveRelevantChunks: no qualifying rows from either source returns an empty array, never an error", async (t) => {
  // Simulates the real WHERE clause having excluded every vector
  // candidate, with no lexical matches either - $queryRaw legitimately
  // returns zero rows for both queries.
  mockModules(t, []);

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "something not in any document", 5);

  assert.deepEqual(results, []);
});

test("retrieveRelevantChunks: a below-threshold candidate excluded by SQL never occupies a slot that would otherwise go to a qualifying result", async (t) => {
  // The mock stands in for the database already having applied the WHERE
  // clause: only the two genuinely-qualifying rows are ever returned, in
  // rank order, even though a caller asked for up to 5 - proving the
  // final result is never artificially padded with (or short by) an
  // excluded candidate's slot.
  mockModules(t, [
    { documentId: "doc-1", documentTitle: "Doc 1", chunkId: "chunk-1", chunkIndex: 0, content: "best match", distance: 0.1 },
    { documentId: "doc-2", documentTitle: "Doc 2", chunkId: "chunk-2", chunkIndex: 0, content: "second match", distance: 0.55 },
  ]);

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 5);

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r: RetrievedChunk) => r.chunkId),
    ["chunk-1", "chunk-2"],
  );
});
