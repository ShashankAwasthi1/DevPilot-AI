import { prisma } from "../config/prisma";
import { getEmbeddingProvider } from "../ai";
import { getProjectAccess } from "./project.service";

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

// Project-scoped semantic search over DocumentChunk. This is the only
// place in the codebase that runs a raw SQL query for RAG purposes -
// search-documents.tool.ts never touches Prisma or SQL directly, matching
// every other tool's pattern of calling one service function.
export async function retrieveRelevantChunks(
  userId: string,
  projectId: string,
  query: string,
  limit: number,
): Promise<RetrievedChunk[]> {
  // Access is checked first, before any embedding/API cost is incurred,
  // and before the projectId is trusted for the query below. projectId and
  // userId here always come from the caller's already-authenticated
  // ToolContext - never from model-controlled tool arguments (see
  // search-documents.tool.ts).
  await getProjectAccess(projectId, userId);

  const embeddingProvider = getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([query]);
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  // Every interpolated value below ($1 vectorLiteral, $2 projectId, $3
  // limit) is a bound parameter via Prisma's tagged-template $queryRaw -
  // never string-concatenated into the SQL text. `vectorLiteral` is safe
  // to build with a plain `.join(",")` because the embedding provider
  // (Step 3) already guarantees every element is a finite JS number before
  // returning it - a finite number's string form can never contain a
  // quote, semicolon, or other SQL-meaningful character. The WHERE clause
  // filters strictly by the caller's own projectId, so this query can
  // never return chunks belonging to a different project.
  const rows = await prisma.$queryRaw<RetrievedChunkRow[]>`
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
    ORDER BY dc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;

  return rows;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
