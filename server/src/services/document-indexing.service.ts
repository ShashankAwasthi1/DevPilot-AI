import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { chunkDocument } from "../ai/chunking";
import { getEmbeddingProvider } from "../ai";
import { prisma } from "../config/prisma";

// Same PrismaClientOrTx pattern as activity.service.ts/notification.service.ts.
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

// The DocumentChunk.embedding column is a fixed vector(1536) (see the Step
// 1 migration) - independent of whatever an EmbeddingProvider happens to
// report, this is checked explicitly below so a future provider swap with
// a mismatched dimension fails loudly here rather than corrupting the
// column at insert time.
const EMBEDDING_DIMENSIONS = 1536;

// OpenAI's embeddings endpoint accepts a batched array in one request, but
// sending a full document's worth of chunks (up to MAX_CHUNKS_PER_DOCUMENT)
// in a single call is unnecessary risk - one large request is an
// all-or-nothing failure. A small, fixed batch size keeps each request
// modest without building a general-purpose queue; not a general
// batching system, just a loop.
const EMBEDDING_BATCH_SIZE = 20;

// Chunk content is passed to the embedding provider as-is, even though an
// overlap-seeded chunk from chunkDocument() (Step 2) can occasionally
// exceed MAX_CHUNK_CHARS by up to CHUNK_OVERLAP_CHARS - reviewed and
// accepted: the worst case (~1352 characters) is still far under any
// embedding provider's per-input token limit (OpenAI's is 8191 tokens,
// roughly 4 characters/token for English text), so no chunking change was
// needed for this step.

// Idempotent: re-running this with unchanged document content always
// converges to the same final chunk rows (delete-then-insert). Safe
// against a document being edited again while this run is still waiting
// on the embedding provider - see the updatedAt check below.
export async function indexDocument(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return; // deleted/never existed - nothing to index

  const capturedUpdatedAt = document.updatedAt;
  const chunks = chunkDocument(document.content);

  if (chunks.length === 0) {
    await prisma.documentChunk.deleteMany({ where: { documentId } });
    return;
  }

  const provider = getEmbeddingProvider();
  if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding provider "${provider.name}" reports ${provider.dimensions} dimensions, but document_chunks.embedding is vector(${EMBEDDING_DIMENSIONS}).`,
    );
  }

  // Generated OUTSIDE any DB transaction - this is a network call to a
  // third-party API and must never hold a Postgres transaction open while
  // it's in flight.
  const embeddings = await embedInBatches(provider, chunks);

  await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: if the document was edited again while we
    // were waiting on the embedding provider, these chunks are already
    // stale for the content that's now live - discard them silently. The
    // newer edit's own indexDocument call (triggered by that edit) will
    // produce correct chunks.
    const current = await tx.document.findUnique({
      where: { id: documentId },
      select: { updatedAt: true },
    });
    if (!current || current.updatedAt.getTime() !== capturedUpdatedAt.getTime()) {
      return;
    }

    await tx.documentChunk.deleteMany({ where: { documentId } });

    // Prisma's Unsupported("vector(1536)") column is excluded from the
    // generated Client entirely - every write here is raw, parameterized
    // SQL. The id column has no database-level default (Prisma's
    // @default(cuid()) is applied client-side, not via a SQL DEFAULT
    // clause - confirmed in the Step 1 migration, which declares "id" TEXT
    // NOT NULL with no default), so it must be supplied here explicitly.
    // randomUUID() is a Node built-in - no new dependency, and there is no
    // requirement that this id be cuid-formatted, only unique.
    for (let i = 0; i < chunks.length; i++) {
      await tx.$executeRaw`
        INSERT INTO document_chunks
          (id, "documentId", "projectId", "chunkIndex", content, "charCount", embedding)
        VALUES
          (${randomUUID()}, ${documentId}, ${document.projectId}, ${i}, ${chunks[i]}, ${chunks[i].length}, ${toVectorLiteral(embeddings[i])}::vector)
      `;
    }
  });
}

// Deletes a document's chunks without any of the embedding/chunking work -
// used when archiving a document (see document.service.ts's
// archiveDocument), which has no external API call involved and can run
// inside that mutation's existing transaction.
export async function deleteChunksForDocument(
  client: PrismaClientOrTx,
  documentId: string,
): Promise<void> {
  await client.documentChunk.deleteMany({ where: { documentId } });
}

async function embedInBatches(
  provider: { embed(texts: string[]): Promise<number[][]> },
  chunks: string[],
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await provider.embed(batch);
    results.push(...batchEmbeddings);
  }
  return results;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
