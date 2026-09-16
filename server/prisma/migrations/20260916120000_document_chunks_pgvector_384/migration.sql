-- Embeddings moved from OpenAI's text-embedding-3-small (1536 dimensions,
-- paid API) to a local model (Xenova/all-MiniLM-L6-v2, 384 dimensions, no
-- API key, runs in-process). pgvector's column dimension is fixed and
-- cannot be resized in place, and existing 1536-dim vectors are not valid
-- data for a 384-dim column, so all existing chunks are dropped here -
-- they carry no information once their embedding is regenerated at a
-- different dimension anyway. The application re-indexes every document
-- after this migration runs (see the re-index step in the accompanying
-- report/README), so this is a safe, intentional data reset scoped to
-- document_chunks only - no other table is touched.

-- DropIndex
DROP INDEX IF EXISTS "document_chunks_embedding_hnsw_idx";

-- Clear stale rows before changing the column type: they were embedded at
-- 1536 dimensions and are meaningless once the column becomes vector(384).
TRUNCATE TABLE "document_chunks";

-- AlterTable
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" TYPE vector(384);

-- CreateIndex
-- Rebuilt against the resized column - same HNSW/cosine choice as the
-- original migration (no tuning parameter needed at this project's
-- scale).
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
