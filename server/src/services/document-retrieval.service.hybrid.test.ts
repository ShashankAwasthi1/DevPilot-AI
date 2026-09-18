import { test } from "node:test";
import assert from "node:assert/strict";
import type { RetrievedChunk } from "./document-retrieval.service";

// End-to-end integration tests proving the full hybrid pipeline wired
// together inside retrieveRelevantChunks: vector retrieval -> threshold
// (already exercised in isolation by document-retrieval.service.threshold
// .test.ts) -> lexical retrieval -> RRF fusion -> diversity cap -> final
// limit. Complements the pure-function tests in
// document-retrieval.service.rrf.test.ts (fusion in isolation) and
// document-retrieval.service.diversity.test.ts (cap in isolation) by
// proving they compose correctly when BOTH vector and lexical results are
// present simultaneously - something those files deliberately don't
// exercise (they isolate one path at a time).

let importCounter = 0;
function importFreshService() {
  return import(`./document-retrieval.service?test=${importCounter++}`) as Promise<
    typeof import("./document-retrieval.service")
  >;
}

function mockModules(
  t: import("node:test").TestContext,
  options: { vectorRows?: unknown[]; lexicalRows?: unknown[] } = {},
) {
  const vectorRows = options.vectorRows ?? [];
  const lexicalRows = options.lexicalRows ?? [];

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
        $queryRaw: async (strings: TemplateStringsArray) => {
          if (strings.join("").includes("ILIKE")) return lexicalRows;
          return vectorRows;
        },
      },
    },
  });
}

function vectorRow(documentId: string, chunkId: string, distance: number) {
  return { documentId, documentTitle: `Title ${documentId}`, chunkId, chunkIndex: 0, content: `content ${chunkId}`, distance };
}

function lexicalRow(documentId: string, chunkId: string) {
  return { documentId, documentTitle: `Title ${documentId}`, chunkId, chunkIndex: 0, content: `content ${chunkId}` };
}

test("retrieveRelevantChunks: fusion occurs before the diversity cap - a chunk boosted by matching both sources still respects the per-document limit", async (t) => {
  // doc-1 contributes 3 vector candidates (would exceed the cap of 2 on
  // its own); one of doc-1's chunks ("d1-b") also matches lexically,
  // boosting its fused rank above doc-1's "d1-a". Only 2 of doc-1's
  // chunks may survive the cap - proving the cap is applied to the FUSED,
  // re-ranked list, not to the raw vector order.
  mockModules(t, {
    vectorRows: [
      vectorRow("doc-1", "d1-a", 0.1),
      vectorRow("doc-1", "d1-b", 0.2),
      vectorRow("doc-1", "d1-c", 0.3),
      vectorRow("doc-2", "d2-a", 0.4),
    ],
    lexicalRows: [lexicalRow("doc-1", "d1-c")], // boosts d1-c above d1-b by fused score
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = (await retrieveRelevantChunks("u1", "project-a", "query", 10)) as RetrievedChunk[];

  const doc1Chunks = results.filter((r) => r.documentId === "doc-1");
  assert.equal(doc1Chunks.length, 2, "the diversity cap (2/document) must still hold after fusion re-ranks doc-1's own chunks");
  // d1-a (vector rank1, no lexical boost: 1/61) vs d1-c (vector rank3 +
  // lexical rank1: 1/63 + 1/61) vs d1-b (vector rank2 only: 1/62).
  // d1-c's boosted score must beat d1-a's, so d1-c survives the cap over
  // d1-b, and doc-2's chunk must still appear (diversity working across
  // documents too).
  assert.deepEqual(
    doc1Chunks.map((c) => c.chunkId).sort(),
    ["d1-a", "d1-c"],
  );
  assert.ok(results.some((r) => r.documentId === "doc-2"), "doc-2's chunk must not be crowded out");
});

test("retrieveRelevantChunks: the final requested limit is applied after fusion and after diversity, and is still respected", async (t) => {
  mockModules(t, {
    vectorRows: [
      vectorRow("doc-1", "c1", 0.1),
      vectorRow("doc-1", "c2", 0.15),
      vectorRow("doc-1", "c3", 0.2), // would be dropped by the cap anyway
      vectorRow("doc-2", "c4", 0.25),
      vectorRow("doc-3", "c5", 0.3),
    ],
    lexicalRows: [lexicalRow("doc-4", "c6")], // lexical-only candidate also in the mix
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 3);

  assert.equal(results.length, 3, "the requested limit (3) is still the hard ceiling after fusion + diversity");
});

test("retrieveRelevantChunks: the vector relevance threshold remains active in the hybrid pipeline (enforced by the mocked vector query itself)", async (t) => {
  // The threshold is enforced in SQL (see document-retrieval.service
  // .threshold.test.ts for the dedicated boundary tests) - this proves
  // the hybrid pipeline doesn't bypass or duplicate that filtering: only
  // whatever the (mocked, already-thresholded) vector query returns is
  // ever fused with lexical results, nothing more.
  mockModules(t, {
    vectorRows: [vectorRow("doc-1", "c1", 0.1)], // simulates SQL having already excluded anything above threshold
    lexicalRows: [],
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].chunkId, "c1");
});

test("retrieveRelevantChunks: no results from either vector or lexical retrieval returns an empty array", async (t) => {
  mockModules(t, { vectorRows: [], lexicalRows: [] });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "nothing matches this", 5);

  assert.deepEqual(results, []);
});

test("retrieveRelevantChunks: a lexical-only match (no vector candidates at all) still surfaces in the final result", async (t) => {
  mockModules(t, {
    vectorRows: [],
    lexicalRows: [lexicalRow("doc-1", "c1")],
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "exact phrase", 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].chunkId, "c1");
  assert.equal(results[0].distance, 1);
});

test("retrieveRelevantChunks: citations (documentId/title) remain derivable from the hybrid result exactly as before", async (t) => {
  mockModules(t, {
    vectorRows: [vectorRow("doc-1", "c1", 0.1)],
    lexicalRows: [lexicalRow("doc-2", "c2")],
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 5);

  const sources = results.map((r) => ({ documentId: r.documentId, title: r.documentTitle }));
  assert.deepEqual(sources.sort((a, b) => a.documentId.localeCompare(b.documentId)), [
    { documentId: "doc-1", title: "Title doc-1" },
    { documentId: "doc-2", title: "Title doc-2" },
  ]);
});
