import { prisma } from "../src/config/prisma";
import { indexDocument } from "../src/services/document-indexing.service";

// One-time re-index after the pgvector-384 migration (embeddings moved
// from OpenAI's 1536-dim provider to the local 384-dim
// Xenova/all-MiniLM-L6-v2 provider, which truncated document_chunks - see
// that migration's own comment). Deliberately reuses indexDocument()
// as-is rather than duplicating its chunking/embedding/DB logic - this
// script is only a driver over documents, not a second implementation of
// indexing. Archived documents are skipped: their chunks were already
// intentionally deleted on archive and have no restore path.
async function main(): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });

  console.log(`Found ${documents.length} non-archived document(s) to re-index.`);

  let failureCount = 0;

  // Sequential, not parallel - keeps the local embedding model's CPU/memory
  // usage bounded to one document at a time, and matches indexDocument's
  // own internal batching of chunks within a single document.
  for (const document of documents) {
    try {
      await indexDocument(document.id);
      console.log(`[ok]   ${document.id}`);
    } catch (err) {
      failureCount++;
      // Never log document content or embeddings - only the id and the
      // error message, same convention as indexAfterCommit in
      // document.service.ts.
      console.error(`[fail] ${document.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done. ${documents.length - failureCount} succeeded, ${failureCount} failed.`);

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Re-index script failed to run:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
