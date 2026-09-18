import { test } from "node:test";
import assert from "node:assert/strict";
import { capPerDocument, type RetrievedChunk } from "./document-retrieval.service";

// "./document-retrieval.service" is only ever evaluated once per resolved
// specifier for a given import specifier - a later t.mock.module call
// does not retroactively change the bindings a module already captured
// on its first import. A unique query string per test forces a fresh
// module instance for the integration tests below, so each test's own
// mocks actually take effect. (The pure capPerDocument tests above don't
// need this - they import the module directly, unmocked.)
let importCounter = 0;
function importFreshService() {
  return import(`./document-retrieval.service?test=diversity-${importCounter++}`) as Promise<
    typeof import("./document-retrieval.service")
  >;
}

// Pure unit tests for capPerDocument - no mocking needed, it's a pure
// function of its two arguments. Mirrors this repo's existing convention
// for testing pure helpers (e.g. chunking.test.ts) directly, independent
// of any SQL/service wiring.

interface FakeChunk {
  documentId: string;
  chunkId: string;
  distance: number;
}

function chunk(documentId: string, chunkId: string, distance: number): FakeChunk {
  return { documentId, chunkId, distance };
}

test("capPerDocument: three or more chunks from the same document are capped at maxPerDocument", () => {
  const input = [
    chunk("doc-1", "c1", 0.1),
    chunk("doc-1", "c2", 0.2),
    chunk("doc-1", "c3", 0.3),
    chunk("doc-1", "c4", 0.4),
  ];

  const result = capPerDocument(input, 2);

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((c) => c.chunkId),
    ["c1", "c2"],
  );
});

test("capPerDocument: multiple documents can each contribute up to the cap", () => {
  const input = [
    chunk("doc-1", "c1", 0.1),
    chunk("doc-1", "c2", 0.15),
    chunk("doc-2", "c3", 0.2),
    chunk("doc-2", "c4", 0.25),
    chunk("doc-3", "c5", 0.3),
  ];

  const result = capPerDocument(input, 2);

  assert.deepEqual(
    result.map((c) => c.chunkId),
    ["c1", "c2", "c3", "c4", "c5"],
  );
});

test("capPerDocument: preserves the existing (input) ordering - it only ever drops entries, never reorders", () => {
  const input = [
    chunk("doc-1", "c1", 0.1),
    chunk("doc-2", "c2", 0.2),
    chunk("doc-1", "c3", 0.3),
    chunk("doc-1", "c4", 0.4), // dropped: doc-1's third
    chunk("doc-2", "c5", 0.5),
  ];

  const result = capPerDocument(input, 2);

  assert.deepEqual(
    result.map((c) => c.chunkId),
    ["c1", "c2", "c3", "c5"],
  );
});

test("capPerDocument: never mutates chunk contents/metadata - the surviving entries are the exact same objects", () => {
  const a = chunk("doc-1", "c1", 0.1);
  const b = chunk("doc-1", "c2", 0.2);
  const input = [a, b];

  const result = capPerDocument(input, 2);

  assert.equal(result[0], a, "the exact same object reference must be returned, never a copy/clone");
  assert.equal(result[1], b);
  // The input array itself is untouched.
  assert.deepEqual(input, [a, b]);
});

test("capPerDocument: is deterministic - repeated calls with the same input produce the exact same output", () => {
  const input = [
    chunk("doc-1", "c1", 0.1),
    chunk("doc-1", "c2", 0.2),
    chunk("doc-1", "c3", 0.3),
    chunk("doc-2", "c4", 0.4),
  ];

  const first = capPerDocument(input, 2);
  const second = capPerDocument(input, 2);

  assert.deepEqual(
    first.map((c) => c.chunkId),
    second.map((c) => c.chunkId),
  );
});

test("capPerDocument: a maxPerDocument of 0 drops everything; a cap larger than any document's count changes nothing", () => {
  const input = [chunk("doc-1", "c1", 0.1), chunk("doc-2", "c2", 0.2)];

  assert.deepEqual(capPerDocument(input, 0), []);
  assert.deepEqual(
    capPerDocument(input, 10).map((c) => c.chunkId),
    ["c1", "c2"],
  );
});

// --- Integration: the cap wired into retrieveRelevantChunks ---------------

// Phase 26 Step 5: retrieveRelevantChunks now issues TWO $queryRaw calls
// (vector, then the new lexical query) - routed here by a structural
// marker only the lexical query's SQL text contains ("ILIKE"). Lexical
// rows default to [] so these diversity tests stay precisely about the
// vector path + capPerDocument, unconfounded by hybrid fusion (covered
// separately by document-retrieval.service.rrf.test.ts and
// document-retrieval.service.hybrid.test.ts).
function mockModulesForRetrieval(
  t: import("node:test").TestContext,
  vectorRows: { documentId: string; documentTitle: string; chunkId: string; chunkIndex: number; content: string; distance: number }[],
) {
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
          if (strings.join("").includes("ILIKE")) return [];
          return vectorRows;
        },
      },
    },
  });
}

function fakeRow(documentId: string, chunkId: string, distance: number) {
  return { documentId, documentTitle: `Title for ${documentId}`, chunkId, chunkIndex: 0, content: `content of ${chunkId}`, distance };
}

test("retrieveRelevantChunks: the diversity cap is applied before the final overall limit, and the overall limit is still respected", async (t) => {
  // Five SQL candidates, four from doc-1 (would otherwise crowd out
  // doc-2) - the cap of 2/document must leave room for doc-2, and the
  // final requested limit of 3 must still be the hard ceiling on the
  // total returned.
  mockModulesForRetrieval(t, [
    fakeRow("doc-1", "c1", 0.1),
    fakeRow("doc-1", "c2", 0.15),
    fakeRow("doc-1", "c3", 0.2),
    fakeRow("doc-1", "c4", 0.25),
    fakeRow("doc-2", "c5", 0.3),
  ]);

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 3);

  assert.equal(results.length, 3, "the overall limit (3) is still the hard ceiling");
  assert.deepEqual(
    results.map((r: RetrievedChunk) => r.chunkId),
    ["c1", "c2", "c5"],
    "doc-1 is capped at 2, and doc-2's chunk survives into the final result instead of being crowded out",
  );
});

test("retrieveRelevantChunks: diversity filtering does not alter chunk contents or document metadata", async (t) => {
  const row = fakeRow("doc-1", "c1", 0.12);
  mockModulesForRetrieval(t, [row]);

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "query", 5);

  assert.deepEqual(results[0], row);
});
