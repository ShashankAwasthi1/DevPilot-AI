import { prisma } from "../src/config/prisma";
import { indexDocument } from "../src/services/document-indexing.service";
import { computeStaleCutoff, parseReindexArgs } from "./reindex-args";

// One-time re-index after the pgvector-384 migration (embeddings moved
// from OpenAI's 1536-dim provider to the local 384-dim
// Xenova/all-MiniLM-L6-v2 provider, which truncated document_chunks - see
// that migration's own comment). Deliberately reuses indexDocument()
// as-is rather than duplicating its chunking/embedding/DB logic - this
// script is only a driver over documents, not a second implementation of
// indexing. Archived documents are skipped: their chunks were already
// intentionally deleted on archive and have no restore path.
//
// Phase 27 Step 5: extended with optional --status=<FAILED|PENDING|READY>
// and --project=<id> filters (see reindex-args.ts), combinable, so a
// targeted retry doesn't have to pay the cost of re-embedding every
// already-healthy document. Default (no flags) behavior is unchanged:
// every non-archived document, exactly as before this step.
//
// Phase 16D (C1): --stale-after-minutes=<n>, combinable only with
// --status=PENDING (enforced in parseReindexArgs), additionally requires
// updatedAt to be older than `n` minutes ago. This is the safe-recovery
// command for a document left stuck PENDING by a crash mid-indexing (see
// docs/runbooks/rag-migration.md) - a document updated more recently than
// the threshold is assumed to still be legitimately indexing right now
// and is deliberately left alone, never swept.
async function main(): Promise<void> {
  const parsed = parseReindexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const { status, projectId, staleAfterMinutes } = parsed.args;
  const staleCutoff = staleAfterMinutes !== undefined ? computeStaleCutoff(staleAfterMinutes) : undefined;

  if (staleCutoff) {
    console.log(
      `Stale-age filter active: only considering PENDING documents last updated more than ` +
        `${staleAfterMinutes} minute(s) ago (before ${staleCutoff.toISOString()}) - more recently ` +
        "updated PENDING documents are assumed to still be legitimately indexing and are skipped.",
    );
  }

  const documents = await prisma.document.findMany({
    where: {
      archivedAt: null,
      ...(status ? { indexStatus: status } : {}),
      ...(projectId ? { projectId } : {}),
      ...(staleCutoff ? { updatedAt: { lt: staleCutoff } } : {}),
    },
    select: { id: true },
  });

  const filterDescription = [
    status ? `status=${status}` : null,
    projectId ? `project=${projectId}` : null,
    staleAfterMinutes !== undefined ? `stale-after-minutes=${staleAfterMinutes}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  console.log(
    `Found ${documents.length} non-archived document(s) to re-index${filterDescription ? ` (${filterDescription})` : ""}.`,
  );

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
