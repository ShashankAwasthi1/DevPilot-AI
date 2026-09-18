import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { chunkDocument } from "../ai/chunking";
import { getEmbeddingProvider } from "../ai";
import { prisma } from "../config/prisma";

// Same PrismaClientOrTx pattern as activity.service.ts/notification.service.ts.
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

// The DocumentChunk.embedding column is a fixed vector(384) (see the
// pgvector-384 migration) - independent of whatever an EmbeddingProvider
// happens to report, this is checked explicitly below so a future
// provider swap with a mismatched dimension fails loudly here rather than
// corrupting the column at insert time.
const EMBEDDING_DIMENSIONS = 384;

// The local embedding model accepts a batched array in one call, but
// running a full document's worth of chunks (up to MAX_CHUNKS_PER_DOCUMENT)
// through the model in a single call is unnecessary risk - one large batch
// is an all-or-nothing failure. A small, fixed batch size keeps each call
// modest without building a general-purpose queue; not a general
// batching system, just a loop.
const EMBEDDING_BATCH_SIZE = 20;

// Chunk content is passed to the embedding provider as-is, even though an
// overlap-seeded chunk from chunkDocument() (Step 2) can occasionally
// exceed MAX_CHUNK_CHARS by up to CHUNK_OVERLAP_CHARS - reviewed and
// accepted: the worst case (~1352 characters) is still far under the
// local model's 256-token input window in token count for typical English
// text, and transformers.js truncates rather than throwing on overlong
// input, so no chunking change was needed for this step.

// Idempotent: re-running this with unchanged document content always
// converges to the same final chunk rows (delete-then-insert). Safe
// against a document being edited again while this run is still waiting
// on the embedding provider - see the updatedAt check below.
//
// Phase 26: the whole function body (embedding call included) is wrapped
// in one try/catch whose only job is indexStatus bookkeeping - never
// business logic. On ANY failure (a dimension mismatch, the embedding
// provider throwing, or the transaction itself failing), a single,
// best-effort, updatedAt-guarded `updateMany` marks the document FAILED,
// then the original error is always rethrown unchanged - this function's
// success/failure contract to its caller (indexAfterCommit) is exactly
// the same as before this phase, only now with a status side effect.
export async function indexDocument(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return; // deleted/never existed - nothing to index

  const capturedUpdatedAt = document.updatedAt;
  const chunks = chunkDocument(document.content);

  try {
    // Empty content genuinely has zero chunks to embed - the embedding
    // provider is never called for it (unchanged from before this phase),
    // but it still flows through the exact same staleness-gated
    // transaction below as non-empty content, so the empty case gets the
    // same optimistic-concurrency protection and the same READY write,
    // never a separate, unguarded code path.
    let embeddings: number[][] = [];
    if (chunks.length > 0) {
      const provider = getEmbeddingProvider();
      if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding provider "${provider.name}" reports ${provider.dimensions} dimensions, but document_chunks.embedding is vector(${EMBEDDING_DIMENSIONS}).`,
        );
      }

      // Generated OUTSIDE any DB transaction - this is a network call to a
      // third-party API and must never hold a Postgres transaction open
      // while it's in flight.
      embeddings = await embedInBatches(provider, chunks);
    }

    await prisma.$transaction(async (tx) => {
      // Optimistic concurrency: if the document was edited again while we
      // were waiting on the embedding provider (or, for empty content,
      // simply since this function's initial read above), this run is
      // already stale for the content that's now live - discard it
      // silently, touching NEITHER the chunks NOR indexStatus. The newer
      // edit's own indexDocument call (triggered by that edit, which also
      // already reset indexStatus to PENDING at save time) is the one
      // that will produce correct chunks and the correct final status.
      const current = await tx.document.findUnique({
        where: { id: documentId },
        select: { updatedAt: true },
      });
      if (!current || current.updatedAt.getTime() !== capturedUpdatedAt.getTime()) {
        return;
      }

      await tx.documentChunk.deleteMany({ where: { documentId } });

      // Prisma's Unsupported("vector(384)") column is excluded from the
      // generated Client entirely - every write here is raw, parameterized
      // SQL. The id column has no database-level default (Prisma's
      // @default(cuid()) is applied client-side, not via a SQL DEFAULT
      // clause - confirmed in the Step 1 migration, which declares "id" TEXT
      // NOT NULL with no default), so it must be supplied here explicitly.
      // randomUUID() is a Node built-in - no new dependency, and there is no
      // requirement that this id be cuid-formatted, only unique. For empty
      // content, chunks.length is 0 and this loop never runs - the delete
      // above is the entire effect, leaving zero chunk rows.
      for (let i = 0; i < chunks.length; i++) {
        await tx.$executeRaw`
          INSERT INTO document_chunks
            (id, "documentId", "projectId", "chunkIndex", content, "charCount", embedding)
          VALUES
            (${randomUUID()}, ${documentId}, ${document.projectId}, ${i}, ${chunks[i]}, ${chunks[i].length}, ${toVectorLiteral(embeddings[i])}::vector)
        `;
      }

      // Committed atomically alongside the chunk replacement above - this
      // is only ever reached once the staleness check has already passed,
      // so READY here always means "these chunks (zero or more) genuinely
      // reflect this document's content as of capturedUpdatedAt".
      await tx.document.update({
        where: { id: documentId },
        data: { indexStatus: "READY" },
      });
    });
  } catch (err) {
    // A separate, independent write - deliberately outside/after the
    // (possibly rolled-back) transaction above, since a transaction
    // failure must never leave chunks partially replaced (Prisma rolls
    // the whole attempt back automatically) yet the failure still needs
    // to be recorded. Guarded by the same updatedAt anchor as every other
    // write in this function: if the document has changed since this run
    // started, `updateMany` affects zero rows and a newer run's own
    // (still in-flight or already-completed) status is never overwritten.
    // Best-effort and non-throwing itself - a failure to record FAILED
    // must never replace or hide the original indexing error below. A
    // plain try/catch (not a chained .catch()) so this is safe even if
    // the call itself throws synchronously rather than rejecting.
    try {
      await prisma.document.updateMany({
        where: { id: documentId, updatedAt: capturedUpdatedAt },
        data: { indexStatus: "FAILED" },
      });
    } catch (bookkeepingErr) {
      console.error(`Failed to record indexStatus=FAILED for document ${documentId}:`, bookkeepingErr);
    }
    throw err;
  }
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
