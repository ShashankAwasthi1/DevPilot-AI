-- Phase 26: tracks whether a Document's search index (its document_chunks
-- rows) is in sync with its current content. See schema.prisma's own
-- DocumentIndexStatus doc comment for the full state-machine description.

-- CreateEnum
CREATE TYPE "DocumentIndexStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable: the ongoing column default stays PENDING, matching
-- schema.prisma's own @default(PENDING) exactly - every future insert
-- that omits this field (application code always sets it explicitly, but
-- this is the correct safety-net default regardless) gets PENDING, never
-- the one-time backfill value below.
ALTER TABLE "documents"
ADD COLUMN "indexStatus" "DocumentIndexStatus" NOT NULL DEFAULT 'PENDING';

-- One-time backfill only, deliberately NOT expressed as the column's own
-- DEFAULT: every pre-existing document has already been through the
-- current indexing pipeline at least once (on its last create/update, and
-- historically via scripts/reindex-documents.ts for the pgvector-384
-- migration), so its document_chunks rows already reflect its current
-- content - PENDING would be factually wrong for these rows. (A document
-- whose last save silently failed to index, pre-Phase-26, cannot be
-- distinguished from a successfully-indexed one from data alone - a
-- disclosed, accepted limitation of this backfill, not a bug.)
UPDATE "documents"
SET "indexStatus" = 'READY';
