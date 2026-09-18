# RAG Migration & Re-index Runbook

Covers deploying schema changes that touch `documents`/`document_chunks`,
and re-indexing the RAG search index when embeddings need to be
regenerated. Written from the actual current repository state as of Phase
27 Step 5 - update it whenever the migration history or indexing code
changes in a way that invalidates something below.

**This document is a runbook, not an implementation record.** Writing it
did not run any migration, apply any schema change, or re-index any
document. See "Scope of this document" at the end of each scenario.

---

## Scenario A: the current, additive migration

**Migration:** `20260918100000_add_document_index_status`

**Status as of this writing:** committed, **not yet applied** to the
database (`prisma migrate status` confirms this - it appears in "Following
migrations have not yet been applied").

### What it does

```sql
CREATE TYPE "DocumentIndexStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

ALTER TABLE "documents"
ADD COLUMN "indexStatus" "DocumentIndexStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "documents"
SET "indexStatus" = 'READY';
```

- **Additive only.** It adds one enum type and one new column to
  `documents`. It does not touch `document_chunks` in any way - no
  truncate, no column change, no index change.
- **No re-index required.** Existing chunks are untouched; the new column
  is a status label describing what's already true (see the migration's
  own comment: every pre-existing document has already been through the
  indexing pipeline at least once).
- **Reversible in principle** (dropping the column/enum would be a clean,
  non-destructive down-migration), but no down-migration has been written
  for it as of this writing - if you want that safety net, author it
  before applying, don't assume it exists.

### Deployment sequence

1. **Backup.** Even for an additive migration, take a database backup or
   confirm the platform's automatic backup/snapshot is current, before
   applying anything. Cheap insurance, not a sign this migration is risky.
2. **Preconditions.** Confirm `prisma migrate status` shows exactly this
   migration (and no unrelated one) pending for the target environment.
3. **Apply the migration.**
   💻 VS Code Terminal
   ```bash
   npx prisma migrate deploy
   ```
4. **Deploy application code** that reads/writes `indexStatus` (already
   written as of Phase 26 - `document.service.ts`,
   `document-indexing.service.ts`, the `DocumentDto` shape).
5. **Verify** (see "Verification examples" below): spot-check a few
   documents' `indexStatus` via the API; confirm pre-existing documents
   show `READY` (the backfill); confirm a fresh create/update produces
   `PENDING` and transitions to `READY`/`FAILED` correctly.
6. **No re-index step.** This scenario never touches `document_chunks`.

> **Important - scope of this document:** applying this migration is
> **not part of the Phase 27 Step 5 implementation**. That step only
> created this runbook, the cache/warm-up/readiness code, and the
> re-index script's filters - it did not run `prisma migrate deploy` or
> touch the database in any way. Applying this migration is a deliberate,
> separate, explicitly-approved action for whoever operates the
> deployment.

---

## Scenario B: a future destructive / vector-dimension migration

**Historical precedent (already applied, not pending):**
`20260916120000_document_chunks_pgvector_384`.

This migration has **already run** against the current database - it is
documented here only as the template for how a *future* embedding
provider/dimension change must be handled, not as something still to be
done.

### What that historical migration did (for reference)

```sql
DROP INDEX IF EXISTS "document_chunks_embedding_hnsw_idx";
TRUNCATE TABLE "document_chunks";
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" TYPE vector(384);
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
```

- Drops the HNSW index (an index built for the old dimension is invalid
  against a resized column).
- **Truncates `document_chunks` unconditionally** - every chunk row is
  deleted. No other table is touched.
- Changes the `embedding` column's declared vector dimension (only
  possible on an empty column - pgvector cannot resize a populated
  `vector(N)` column to a different `N`).
- Rebuilds the HNSW index against the resized column.
- **Requires a full re-index** of every non-archived document - their
  chunks are gone.

Any future change to the embedding provider or its output dimension
(a different local model, a different provider entirely) will need the
same shape of migration, with the same consequences.

### Deployment sequence (for the next time this happens)

1. **Backup.** A full backup/snapshot immediately before the migration
   runs - this is the entire rollback strategy (see "Rollback" below), not
   a formality.
2. **Maintenance / disable RAG search.** The migration itself only touches
   `document_chunks`, not `documents`/tasks/projects/etc., so a full
   maintenance page is not required. Recommended instead: temporarily
   disable the `searchDocuments` AI tool / RAG search UI (a feature flag,
   not full downtime) for the duration of truncation → re-index
   completion, since search will return degraded (empty/sparse) results
   until re-indexing finishes.
3. **Apply the migration.**
   💻 VS Code Terminal
   ```bash
   npx prisma migrate deploy
   ```
4. **Deploy compatible application code** - must happen only after (or
   atomically with) the migration. Old code targeting the previous
   dimension will fail loudly at the dimension check in
   `document-indexing.service.ts` (`Embedding provider "..." reports N
   dimensions, but document_chunks.embedding is vector(M)`) rather than
   corrupt data - this is a safety feature, not a bug, if it's hit.
5. **Re-index.**
   💻 VS Code Terminal
   ```bash
   npm run reindex
   ```
   Or, to retry only what's actually broken (see "Re-index CLI reference"
   below):
   💻 VS Code Terminal
   ```bash
   npm run reindex -- --status=FAILED
   ```
6. **Verification** (see below).
7. **Re-enable RAG search** if it was feature-flagged off in step 2.

### Rollback - stated honestly

**The truncation is not safely reversible by Prisma, and there is no
automatic rollback.** Prisma's migration model is forward-only; even a
hand-written down-migration could only recreate an empty column at the old
dimension - it cannot reconstruct embeddings that were deleted by
`TRUNCATE`.

**The actual rollback mechanism is restoring the database from the
backup taken in step 1.** If you need to roll back after this kind of
migration, the correct action is "restore from the pre-migration backup,"
never "write a reverse migration."

**Data-loss window:** restoring from a backup taken before the migration
means losing every write (new documents, edited tasks, new comments,
everything - not just RAG data) that happened between the backup and the
restore. This is why step 2 (disabling RAG search / a short maintenance
window) matters: it shrinks that window, it doesn't eliminate it. Plan the
backup to be taken as close to the migration as practical.

### Failure scenarios and what actually happens

- **Migration succeeds, re-index fails entirely** (e.g. the re-index
  process never starts, or dies before processing anything):
  `document_chunks` stays empty. The rest of the app keeps working - auth,
  projects, tasks are untouched. RAG search returns no results (degraded,
  not broken). `indexStatus` on affected documents will show whatever the
  historical value already was, or `FAILED` if `indexDocument` was
  actually attempted and threw.
- **Only some documents re-index** (the script fails partway through, or
  is interrupted): this is the script's normal, expected failure mode -
  per-document try/catch means one failure never aborts the run, and the
  script's own final summary line and non-zero exit code tell you exactly
  how many failed. Re-run with `--status=FAILED` to retry only those.
- **The embedding model cannot download** (network failure, Hugging Face
  unreachable): every `indexDocument` call in the run fails at the
  embedding step, marking every attempted document `FAILED`. The app
  itself does not go down - this is a re-index script failure, not a
  server startup failure, since nothing in `server.ts` blocks startup on
  the embedding model being available (see "Embedding model cache and
  warm-up" below for the one exception - the optional warm-up - and how it
  is deliberately non-fatal too).
- **A re-index process is killed mid-run** (SIGKILL, container restart,
  manual interrupt): whatever documents were already processed before the
  kill are correctly `READY`/`FAILED` (each document's write is atomic and
  independent). The remaining, never-attempted documents are simply
  untouched - safely re-run the same command again; `indexDocument` is
  idempotent (delete-then-insert chunks), so re-running never double-writes
  or corrupts anything.
- **The application is deployed before re-indexing completes:** harmless
  but degraded, per the historical migration's own design intent -
  `retrieveRelevantChunks` just queries a smaller/empty `document_chunks`
  table and returns fewer/no results; it does not error. The risk isn't a
  crash, it's this going unnoticed as "the AI just quietly gives worse
  answers" - which is exactly why step 2 (disable RAG search) and the
  verification steps below matter.
- **Stale `indexStatus` edge case:** a document that a re-index run never
  actually attempted (e.g., the run crashed before reaching it, or was
  narrowly filtered by `--project`/`--status` in a way that excluded it)
  keeps whatever `indexStatus` it already had - which could still say
  `READY` from *before* a truncation, even though its chunks are now
  gone. This is a known, currently-undetectable-from-data-alone limitation
  (the same one documented in the `add_document_index_status` migration's
  own comment for the pre-Phase-26 backfill) - not a bug, but a reason the
  `document_chunks` row-count check below matters more than trusting
  `indexStatus` alone after a destructive migration.

### Re-index CLI reference

```bash
# Default: every non-archived document (unchanged from before Phase 27 Step 5)
npm run reindex

# Only documents whose last indexing attempt failed
npm run reindex -- --status=FAILED

# Only documents that have never successfully finished indexing
npm run reindex -- --status=PENDING

# Force-rebuild documents that already report READY (e.g. after a
# dimension change, when indexStatus can no longer be trusted - see the
# stale-indexStatus edge case above)
npm run reindex -- --status=READY

# Scope to one project
npm run reindex -- --project=<PROJECT_ID>

# Filters combine
npm run reindex -- --status=FAILED --project=<PROJECT_ID>
```

An unsupported `--status` value or an empty `--project=` value fails
immediately with a clear message and a non-zero exit code, before any
database query runs.

---

## Verification examples

Run these after any migration/re-index, substituting real ids. None of
these commands modify data.

**Migration status:**
💻 VS Code Terminal
```bash
npx prisma migrate status
```

**A document's `indexStatus`** (via the existing API, replacing ids):
💻 VS Code Terminal
```bash
curl -s http://localhost:8080/api/v1/projects/<PROJECT_ID>/documents/<DOCUMENT_ID> \
  -H "Cookie: devpilot_session=<SESSION_COOKIE>" | jq '.data.indexStatus'
```

**`document_chunks` row-count sanity check** (run via `psql` or the
platform's SQL console - never paste real connection strings/credentials
into a shared doc or chat):
```sql
SELECT COUNT(*) FROM document_chunks;
SELECT COUNT(DISTINCT "documentId") FROM document_chunks;
```
Compare the second number against the count of non-archived documents -
they should be close (documents with genuinely empty content correctly
have zero chunks).

**A known-document RAG search actually returns results** - use the
existing chat UI (or the `searchDocuments` AI tool via a real chat/agent
turn) against a document you know contains a specific phrase, and confirm
it comes back as a cited source.

**Count of `FAILED` documents:**
```sql
SELECT COUNT(*) FROM documents WHERE "indexStatus" = 'FAILED' AND "archivedAt" IS NULL;
```
Should be zero after a clean re-index; a non-zero count after running
`npm run reindex` means re-running `npm run reindex -- --status=FAILED`
is needed (or that the embedding provider itself is unreachable - check
server logs for the generic "Could not run the local embedding model"
error).

**Embedding model readiness:**
💻 VS Code Terminal
```bash
curl -s http://localhost:8080/api/v1/ready | jq
```
Returns `{"status":"ok","data":{"embeddingModel":"idle"|"loading"|"ready"|"failed"}}`.
Always HTTP 200 - this is an observability signal, not a traffic gate (see
below).

---

## Embedding model cache, warm-up, and readiness

Added in Phase 27 Step 5, alongside this runbook.

### Cache location

`@xenova/transformers` downloads model weights from Hugging Face on first
use and caches them on disk. Its own default cache directory is
`<package-install-dir>/.cache/` - **inside `node_modules`**. This matters
because a typical redeploy (`npm install` against a fresh build) wipes
`node_modules`, and therefore wipes that cache, forcing a full re-download
on every deploy, not just every container restart.

As of this step, the cache directory is set explicitly (in
`local-embedding-provider.ts`, before the first `pipeline()` call) via:

```
EMBEDDING_MODEL_CACHE_DIR=/path/to/persistent/cache
```

If unset, it defaults to `./.cache/transformers-model` relative to the
server's working directory - fine for local development, but still inside
the ephemeral container filesystem in production unless a persistent
volume is mounted there.

**This is deliberately not the Python-only `HF_HOME`/`TRANSFORMERS_CACHE`
convention.** Those are read by Python's `huggingface_hub`/`transformers`
libraries; this project uses the JS `@xenova/transformers` package, which
only reads its own `env.cacheDir` property - setting `HF_HOME` would have
no effect here.

**This code change does not, by itself, make the cache durable in
production.** Setting `EMBEDDING_MODEL_CACHE_DIR` only decides *where* the
cache lives - it is still the deploy platform's responsibility to mount an
actual persistent volume/disk at that path. Render, Fly, and Railway (the
documented deployment targets per `docs/adr/0001-separate-express-backend.md`)
all support persistent volumes, but provisioning one is a platform
configuration step outside this repository, not something this code can
do on its own. Without a real persistent volume behind
`EMBEDDING_MODEL_CACHE_DIR`, every fresh deploy still re-downloads the
model - the env var just gives you somewhere to point one once it exists.

### Startup warm-up

Optional, off by default. Set:

```
EMBEDDING_MODEL_WARMUP=true
```

to trigger one embedding-model load at server startup instead of waiting
for the first real request. It is fire-and-forget: it never blocks
`app.listen`, and a failure (e.g. the model can't download) is logged
generically and swallowed - it never crashes the process or prevents the
server from accepting connections. Left disabled (the default), the model
still loads correctly on first real use; warm-up only avoids paying that
cost on the very first user-facing request. Left off for local
development on purpose, so `npm run dev` restarts stay fast.

### Readiness semantics

`GET /api/v1/ready` reports the embedding model's load state
(`idle`/`loading`/`ready`/`failed`) but **always responds HTTP 200**. This
is intentional: a failed or still-loading embedding model degrades RAG
search (fewer/no results) but never breaks the rest of the application
(auth, projects, tasks, comments, etc.), so this endpoint is an
observability signal for monitoring/dashboards, not a traffic-routing
gate. `GET /api/v1/health` remains a pure liveness check with no
dependency on the embedding model or the database - a platform's restart
policy should never be tied to RAG's health.

### Fresh-deploy cold-start considerations

Putting the above together: on a fresh deploy with no persistent volume
configured, the first request that needs the embedding model (a document
create/update, or a RAG search) after that deploy will pay a real
network-download-plus-initialization cost, once, blocking that one
request. Warm-up moves that cost earlier (to server startup) but does not
eliminate it unless the cache directory is actually persistent across
deploys. Neither warm-up nor the cache-dir env var is a substitute for
provisioning a real persistent volume if consistently avoiding this cost
in production matters.
