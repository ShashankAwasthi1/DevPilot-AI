import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRetrievalCandidates, rrfContribution, type RetrievedChunk } from "./document-retrieval.service";

// Pure unit tests for rrfContribution/fuseRetrievalCandidates - no mocking
// needed, both are pure functions of their arguments. Mirrors this repo's
// existing convention for testing pure helpers (e.g. chunking.test.ts,
// capPerDocument's own tests) directly, independent of any SQL/service
// wiring.

function vectorChunk(documentId: string, chunkId: string, distance: number): RetrievedChunk {
  return {
    documentId,
    documentTitle: `Title ${documentId}`,
    chunkId,
    chunkIndex: 0,
    content: `content ${chunkId}`,
    distance,
  };
}

function lexicalRow(documentId: string, chunkId: string) {
  return { documentId, documentTitle: `Title ${documentId}`, chunkId, chunkIndex: 0, content: `content ${chunkId}` };
}

// --- rrfContribution: exact k=60, 1-based-rank arithmetic ------------------

test("rrfContribution: rank 1 is exactly 1/61 (k=60, 1-based rank)", () => {
  assert.equal(rrfContribution(1), 1 / 61);
});

test("rrfContribution: rank 2 is exactly 1/62", () => {
  assert.equal(rrfContribution(2), 1 / 62);
});

test("rrfContribution: strictly decreases as rank increases (worse rank -> smaller contribution)", () => {
  assert.ok(rrfContribution(1) > rrfContribution(2));
  assert.ok(rrfContribution(2) > rrfContribution(20));
});

// --- fuseRetrievalCandidates: contributions, summing, dedup ---------------

test("fuseRetrievalCandidates: a vector-only candidate at rank 1 preserves its real vector distance", () => {
  const result = fuseRetrievalCandidates([vectorChunk("doc-1", "c1", 0.1)], []);

  assert.equal(result.length, 1);
  assert.equal(result[0].chunkId, "c1");
  assert.equal(result[0].distance, 0.1, "the real vector distance must be preserved");
});

test("fuseRetrievalCandidates: a lexical-only candidate at rank 1 receives the neutral distance placeholder (1)", () => {
  const result = fuseRetrievalCandidates([], [lexicalRow("doc-1", "c1")]);

  assert.equal(result.length, 1);
  assert.equal(result[0].chunkId, "c1");
  assert.equal(result[0].distance, 1, "a lexical-only chunk must carry the neutral distance placeholder, 1");
});

test("fuseRetrievalCandidates: a candidate appearing in both lists outranks single-source candidates by the sum of both contributions", () => {
  // c1: vector rank 1 (1/61) + lexical rank 1 (1/61) = 2/61
  // c2: vector rank 2 only (1/62)
  // c3: lexical rank 2 only (1/62)
  // 2/61 > 1/62, so c1 must come first. c2 and c3 tie at 1/62, but c2 has
  // a real (lower) distance than c3's placeholder, so c2 sorts before c3.
  const result = fuseRetrievalCandidates(
    [vectorChunk("doc-1", "c1", 0.1), vectorChunk("doc-2", "c2", 0.2)],
    [lexicalRow("doc-1", "c1"), lexicalRow("doc-3", "c3")],
  );

  assert.deepEqual(
    result.map((r) => r.chunkId),
    ["c1", "c2", "c3"],
  );
  assert.equal(result[0].distance, 0.1, "c1 keeps its real vector distance, not the lexical placeholder");
});

test("fuseRetrievalCandidates: duplicate chunk ids (present in both lists) become exactly one fused candidate, never two", () => {
  const result = fuseRetrievalCandidates([vectorChunk("doc-1", "c1", 0.1)], [lexicalRow("doc-1", "c1")]);

  assert.equal(result.length, 1);
  assert.equal(result[0].chunkId, "c1");
});

test("fuseRetrievalCandidates: multiple chunks from the same document remain separate candidates - deduplication is by chunkId, never documentId", () => {
  const result = fuseRetrievalCandidates(
    [vectorChunk("doc-1", "c1", 0.1), vectorChunk("doc-1", "c2", 0.2), vectorChunk("doc-1", "c3", 0.3)],
    [],
  );

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.chunkId).sort(),
    ["c1", "c2", "c3"],
  );
});

// --- Final ordering: RRF desc, distance asc, chunkId asc -------------------

test("fuseRetrievalCandidates: final ordering is RRF score descending", () => {
  const result = fuseRetrievalCandidates(
    [vectorChunk("doc-1", "c-low", 0.5), vectorChunk("doc-2", "c-high", 0.1)],
    [lexicalRow("doc-2", "c-high")], // also matches lexically -> higher combined score
  );

  assert.deepEqual(
    result.map((r) => r.chunkId),
    ["c-high", "c-low"],
  );
});

test("fuseRetrievalCandidates: vector distance is the secondary sort key when RRF scores tie", () => {
  // A vector rank-1 candidate (1/61) and a lexical rank-1 candidate
  // (1/61) from disjoint chunks tie exactly on rrfScore. The vector
  // candidate's real distance must sort before the lexical-only
  // placeholder (1) on that tie.
  const result = fuseRetrievalCandidates([vectorChunk("doc-1", "c-vector", 0.3)], [lexicalRow("doc-2", "c-lexical")]);

  assert.deepEqual(
    result.map((r) => r.chunkId),
    ["c-vector", "c-lexical"],
  );
});

test("fuseRetrievalCandidates: chunkId is the deterministic final tie-breaker when both RRF score and distance tie", () => {
  // c1: vector rank 1 (dist 0.2) + lexical rank 2 -> 1/61 + 1/62
  // c2: vector rank 2 (dist 0.2) + lexical rank 1 -> 1/62 + 1/61
  // Addition is commutative, so these scores are exactly equal; both
  // candidates also carry the SAME real vector distance (0.2), so score
  // and distance both tie - only chunkId ("c1" < "c2") can break it.
  const result = fuseRetrievalCandidates(
    [vectorChunk("doc-1", "c1", 0.2), vectorChunk("doc-2", "c2", 0.2)],
    [lexicalRow("doc-2", "c2"), lexicalRow("doc-1", "c1")],
  );

  assert.deepEqual(
    result.map((r) => r.chunkId),
    ["c1", "c2"],
  );
});

test("fuseRetrievalCandidates: is deterministic - repeated calls with the same input produce the exact same output", () => {
  const vectorCandidates = [vectorChunk("doc-1", "c1", 0.1), vectorChunk("doc-2", "c2", 0.2)];
  const lexicalCandidates = [lexicalRow("doc-3", "c3")];

  const first = fuseRetrievalCandidates(vectorCandidates, lexicalCandidates);
  const second = fuseRetrievalCandidates(vectorCandidates, lexicalCandidates);

  assert.deepEqual(
    first.map((r) => r.chunkId),
    second.map((r) => r.chunkId),
  );
});

test("fuseRetrievalCandidates: empty vector and lexical inputs produce an empty result", () => {
  assert.deepEqual(fuseRetrievalCandidates([], []), []);
});
