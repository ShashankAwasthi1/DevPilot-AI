import { prisma } from "../config/prisma";
import { getEmbeddingProvider } from "../ai";
import { AI_LIMITS } from "../ai/limits";
import { getProjectAccess } from "./project.service";

// Phase 26 Step 4: the maximum number of chunks any single document may
// contribute to a final result set. A pure, deterministic, side-effect-
// free helper - never mutates its input, never reorders (only ever drops
// entries), and inspects nothing beyond documentId. Exported so it can be
// unit-tested directly, independent of any SQL/mocking.
const MAX_CHUNKS_PER_DOCUMENT = 2;

export function capPerDocument<T extends { documentId: string }>(chunks: T[], maxPerDocument: number): T[] {
  const countByDocument = new Map<string, number>();
  const result: T[] = [];

  for (const chunk of chunks) {
    const count = countByDocument.get(chunk.documentId) ?? 0;
    if (count >= maxPerDocument) continue;
    countByDocument.set(chunk.documentId, count + 1);
    result.push(chunk);
  }

  return result;
}

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  distance: number;
}

interface RetrievedChunkRow {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  distance: number;
}

// Phase 26 Step 5: the row shape returned by the new lexical query - the
// same chunk-level fields the vector query returns, minus `distance`
// (lexical matching has no cosine distance of its own). Deliberately its
// own interface, not derived from RetrievedChunkRow via Omit/Pick, matching
// this file's own existing precedent of RetrievedChunk/RetrievedChunkRow
// being two independently declared, structurally-identical interfaces.
interface LexicalCandidateRow {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
}

// Phase 26 Step 5: Reciprocal Rank Fusion constant - the standard,
// widely-cited default from the original RRF formulation (Cormack et
// al.), not a value tuned for this project. Kept as a named constant
// rather than inlined so its provenance is unambiguous at every use site.
const RRF_K = 60;

// Phase 26 Step 5: assigned to a chunk that was found only by lexical
// search (it never appeared in the vector candidate list, so it has no
// real cosine distance). A genuine vector-path distance can never reach
// this value - AI_LIMITS.MAX_SEARCH_DISTANCE (0.6) already bounds every
// real vector result well below it - so this placeholder is always
// unambiguously distinguishable from a real distance without needing a
// separate "has a real distance" flag anywhere downstream, including in
// the final tie-break sort (see fuseRetrievalCandidates below).
const LEXICAL_ONLY_DISTANCE_PLACEHOLDER = 1;

// Phase 26 Step 5: escapes the characters that are meaningful to
// Postgres's LIKE/ILIKE pattern matching (% and _) plus the escape
// character itself (\, paired with the explicit ESCAPE '\' the lexical
// query below always specifies) - so a user's literal "%", "_", or "\" in
// their search text is matched as that literal character, never treated
// as a wildcard or escape-introducer. This is a correctness fix, not a
// SQL-injection concern by itself: $queryRaw's tagged template already
// binds the resulting pattern as a literal parameter value, never SQL
// syntax, with or without this escaping - but without it, a query
// containing e.g. "50%" would silently match anything after "50" instead
// of the literal text the user typed.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Vector semantic search over DocumentChunk, scoped to the project and
// bounded by the relevance threshold - unchanged in behavior from Step 4,
// only extracted into its own function so retrieveRelevantChunks below
// reads as "vector candidates + lexical candidates + fuse", not one long
// function.
async function retrieveVectorCandidates(
  projectId: string,
  vectorLiteral: string,
): Promise<RetrievedChunkRow[]> {
  // Every interpolated value below is a bound parameter via Prisma's
  // tagged-template $queryRaw - never string-concatenated into the SQL
  // text. `vectorLiteral` is safe to build with a plain `.join(",")`
  // because the embedding provider already guarantees every element is a
  // finite JS number before returning it - a finite number's string form
  // can never contain a quote, semicolon, or other SQL-meaningful
  // character. The WHERE clause filters strictly by the caller's own
  // projectId, so this query can never return chunks belonging to a
  // different project. The distance predicate excludes anything below the
  // relevance floor before LIMIT is ever applied - a correctness
  // requirement, not just an optimization: doing this after an already-
  // LIMIT-ed fetch could silently return fewer than the true best-N
  // above-threshold candidates.
  return prisma.$queryRaw<RetrievedChunkRow[]>`
    SELECT
      dc."documentId"  AS "documentId",
      d.title           AS "documentTitle",
      dc.id             AS "chunkId",
      dc."chunkIndex"   AS "chunkIndex",
      dc.content        AS "content",
      dc.embedding <=> ${vectorLiteral}::vector AS "distance"
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE dc."projectId" = ${projectId}
      AND dc.embedding <=> ${vectorLiteral}::vector <= ${AI_LIMITS.MAX_SEARCH_DISTANCE}
    ORDER BY dc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${AI_LIMITS.SEARCH_CANDIDATE_LIMIT}
  `;
}

// Phase 26 Step 5: a thin, internal, chunk-level lexical/keyword query -
// deliberately NOT a reuse of document.service.ts's searchDocumentsInProject
// (which searches whole documents and returns truncated document content,
// not individual chunks with distance/rank identity). Hybrid fusion below
// needs the exact same chunk-level unit the vector path already returns,
// so a chunk is what this queries and returns too. No new schema, index,
// or extension: document_chunks(projectId) (the existing index) narrows
// to the project first, then an unindexed ILIKE scans that already-small,
// already project-scoped subset - the same performance posture
// searchDocumentsInProject's own unindexed `contains` already accepts at
// document granularity today, one level deeper. There is no native
// lexical relevance score to order by, so results are ordered
// deterministically by (documentId, chunkIndex) - served directly by the
// existing @@index([documentId, chunkIndex]) on document_chunks, no new
// index needed - and that row order becomes each row's 1-based lexical
// rank for RRF below.
async function retrieveLexicalCandidates(
  projectId: string,
  query: string,
): Promise<LexicalCandidateRow[]> {
  const pattern = `%${escapeLikePattern(query)}%`;

  // Same parameterization discipline as the vector query above: projectId
  // and pattern are both bound values, never concatenated into the SQL
  // text. ESCAPE '\' is specified explicitly (Postgres's own LIKE/ILIKE
  // default escape character is already backslash, but this is written
  // out rather than relied upon implicitly) and paired with
  // escapeLikePattern's own backslash-based escaping above.
  return prisma.$queryRaw<LexicalCandidateRow[]>`
    SELECT
      dc."documentId"  AS "documentId",
      d.title           AS "documentTitle",
      dc.id             AS "chunkId",
      dc."chunkIndex"   AS "chunkIndex",
      dc.content        AS "content"
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE dc."projectId" = ${projectId}
      AND dc.content ILIKE ${pattern} ESCAPE '\\'
    ORDER BY dc."documentId" ASC, dc."chunkIndex" ASC
    LIMIT ${AI_LIMITS.SEARCH_CANDIDATE_LIMIT}
  `;
}

// One candidate's RRF contribution at a given 1-based rank - split out as
// its own tiny, exported pure function purely so the exact k=60 arithmetic
// can be unit-tested directly (e.g. rrfContribution(1) === 1/61), without
// exposing the (summed, per-chunk) rrfScore itself through fuseRetrieval
// Candidates' return value or the public RetrievedChunk shape.
export function rrfContribution(rank: number): number {
  return 1 / (RRF_K + rank);
}

// Reciprocal Rank Fusion: merges the vector-ranked and lexical-ranked
// candidate lists into one, using only each list's ORDINAL RANK - never
// their raw scores, which aren't comparable (a bounded cosine distance vs.
// a substring match with no native score at all). Deduplicates by
// chunkId, never documentId - multiple chunks from the same document
// remain separate candidates here; document-level diversity is
// capPerDocument's job, applied afterward by the caller. A chunk present
// in both lists is one fused candidate whose score is the SUM of both
// contributions, keeping the REAL vector distance it already had (never
// overwritten by the lexical-only placeholder - a lexical-list entry for
// an already-seen chunkId only ever adds to `rrfScore`, it never touches
// `chunk`). Exported as a pure function so it can be unit-tested directly,
// independent of any SQL/mocking; its internal rrfScore is discarded
// before this module's public retrieveRelevantChunks ever returns a
// value, so it never leaks into the public RetrievedChunk shape.
export function fuseRetrievalCandidates(
  vectorCandidates: RetrievedChunk[],
  lexicalCandidates: LexicalCandidateRow[],
): RetrievedChunk[] {
  const fused = new Map<string, { chunk: RetrievedChunk; rrfScore: number }>();

  vectorCandidates.forEach((chunk, index) => {
    const rank = index + 1; // 1-based, per the approved RRF formula
    fused.set(chunk.chunkId, { chunk, rrfScore: rrfContribution(rank) });
  });

  lexicalCandidates.forEach((row, index) => {
    const rank = index + 1; // 1-based
    const contribution = rrfContribution(rank);
    const existing = fused.get(row.chunkId);
    if (existing) {
      existing.rrfScore += contribution;
    } else {
      fused.set(row.chunkId, {
        chunk: { ...row, distance: LEXICAL_ONLY_DISTANCE_PLACEHOLDER },
        rrfScore: contribution,
      });
    }
  });

  // Deterministic final ordering: RRF score descending, then vector
  // distance ascending (a real distance is always <= MAX_SEARCH_DISTANCE,
  // strictly below the lexical-only placeholder, so this naturally
  // prefers an actual vector match over a lexical-only one on a score
  // tie), then chunkId ascending as the last, fully deterministic
  // tie-breaker.
  return Array.from(fused.values())
    .sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
      if (a.chunk.distance !== b.chunk.distance) return a.chunk.distance - b.chunk.distance;
      return a.chunk.chunkId.localeCompare(b.chunk.chunkId);
    })
    .map((entry) => entry.chunk);
}

// Project-scoped hybrid (vector + lexical) search over DocumentChunk.
// This is the only place in the codebase that runs raw SQL for RAG
// purposes - search-documents.tool.ts never touches Prisma or SQL
// directly, matching every other tool's pattern of calling one service
// function. Authorization is checked exactly once, here, before either
// query runs - never re-checked per chunk/candidate.
export async function retrieveRelevantChunks(
  userId: string,
  projectId: string,
  query: string,
  limit: number,
): Promise<RetrievedChunk[]> {
  // Access is checked first, before any embedding/API cost is incurred,
  // and before the projectId is trusted for either query below. projectId
  // and userId here always come from the caller's already-authenticated
  // ToolContext - never from model-controlled tool arguments (see
  // search-documents.tool.ts).
  await getProjectAccess(projectId, userId);

  const embeddingProvider = getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([query]);
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  // Exactly one embedding call, one vector SQL query, and one lexical SQL
  // query per search - independent, read-only queries with no shared
  // mutable state, run concurrently rather than one after the other.
  const [vectorCandidates, lexicalCandidates] = await Promise.all([
    retrieveVectorCandidates(projectId, vectorLiteral),
    retrieveLexicalCandidates(projectId, query),
  ]);

  const fused = fuseRetrievalCandidates(vectorCandidates, lexicalCandidates);

  // Diversity cap applied after fusion, before the final overall limit -
  // preserves the fused RRF ordering (capping only ever drops entries,
  // never reorders), and only THEN truncates to exactly what the caller
  // asked for.
  return capPerDocument(fused, MAX_CHUNKS_PER_DOCUMENT).slice(0, limit);
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
