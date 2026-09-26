# DevPilot AI — Production Deployment Runbook

Last verified: 2026-09-26, against branch `phase-14-rag`.

This runbook documents DevPilot AI's current production deployment as it actually exists today — not an aspirational or planned architecture. Where a fact is directly verifiable from this repository, it is stated as fact. Where a fact depends on a third-party dashboard (Render, Vercel, Neon) that is not represented in source control, that is called out explicitly — **treat those as needing a live check, not as guaranteed by this document.**

## 1. Architecture overview

DevPilot AI is a two-service application, not a single deployable unit:

```
Browser
  │
  ▼
Next.js frontend (client/)  ──deployed on──▶  Vercel
  │  (cross-origin, credentialed fetch, client/lib/api.ts)
  ▼
Express + TypeScript backend (server/)  ──deployed on──▶  Render
  │  (Prisma + @prisma/adapter-neon)
  ▼
Neon PostgreSQL (pgvector extension enabled)
```

- The frontend never talks to the database directly and never embeds any secret — it only calls the backend's HTTP API with `credentials: "include"` so the session cookie (set by the backend's own origin) is attached.
- The backend is the only component that talks to Neon, to the configured AI provider (Anthropic or Gemini), and that holds any secret.
- Schema changes to the production database are **not** applied automatically by either Render or Vercel deploying — they go through a separate, manually-triggered GitHub Actions workflow (`.github/workflows/db-migrate.yml`, see §5).
- This split (two services instead of one Next.js app doing both jobs) is a deliberate, already-recorded architectural decision — see `docs/adr/0001-separate-express-backend.md` for the full rationale.

## 2. Production components

### Frontend

| Item | Value | Source |
|---|---|---|
| Vercel project | `devpilot-ai` | dashboard-managed |
| Production URL | `https://dev-pilot-ai-six.vercel.app` | dashboard-managed |
| Root directory | `client` | dashboard-managed |
| Framework | Next.js | verified — `client/package.json` |
| Node version | `22.x` | verified — `client/package.json`'s `engines` field, root `.nvmrc` |
| Build command | `npm run build` (`next build`) | verified — `client/package.json` scripts |
| Start command | handled automatically by Vercel's Next.js integration — do not assume a manual `next start` invocation is configured | dashboard-managed |

**Required environment variable names** (values are dashboard-managed secrets/config, never committed):
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SITE_URL`

### Backend

| Item | Value | Source |
|---|---|---|
| Render service | `DevPilot-AI` | dashboard-managed |
| Production branch | `phase-14-rag` | dashboard-managed |
| Root directory | `server` | dashboard-managed |
| Region | Singapore | dashboard-managed |
| Build command | `npm ci --include=dev && npm run build` | dashboard-managed |
| Start command | `npm start` (`node dist/server.js`) | dashboard-managed |
| Node version | `22.x` | verified — `server/package.json`'s `engines` field, root `.nvmrc` |
| Health endpoint | `GET /api/v1/health` (pure liveness, always 200) | verified — `server/src/controllers/health.controller.ts` |
| Readiness endpoint | `GET /api/v1/ready` (DB-gated: 200 healthy / 503 if the database is unreachable) | verified — same file |
| Production URL | `https://devpilot-ai-hf9u.onrender.com` | dashboard-managed |

**Important**: build command, start command, region, and which health/readiness path (if either) Render's own health-check/restart mechanism actually polls are all **dashboard-only settings with no representation in this repository** (no `render.yaml` exists — see §10). The values above reflect the currently-known configuration at the time of writing; **verify them directly in the Render dashboard before relying on this document as an exact, current infrastructure snapshot.**

### Database

| Item | Value |
|---|---|
| Provider | Neon PostgreSQL |
| Production branch (Neon's own branching concept) | `production` |
| Database name | `devpilot` |
| Region | AWS Asia Pacific 1 (Singapore) |
| Extensions | `pgvector` (used for document embedding search — see `server/prisma/schema.prisma`'s `extensions = [vector]`) |
| ORM | Prisma (`@prisma/client` + `@prisma/adapter-neon` driver adapter — see the Phase 18 Neon-adapter migration) |
| Connection pooling | Enabled |
| `DATABASE_URL` | The pooled connection string — used by the running application at runtime |
| `DATABASE_URL_UNPOOLED` | The direct/unpooled connection string — used by Prisma's `directUrl` (CLI/migration operations) and nowhere else in application runtime code |

No actual connection string, credential, or secret value is included in this document or should ever be committed anywhere in this repository.

## 3. Environment variables

Names and purposes only — no values.

### Render (backend)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Neon connection string (runtime) |
| `DATABASE_URL_UNPOOLED` | Direct Neon connection string (Prisma `directUrl`, CLI/migrations) |
| `PORT` | Port the server listens on (optional — defaults to `8080` if unset) |
| `NODE_ENV` | Should be `production` in Render |
| `CORS_ORIGIN` | The single allowed frontend origin for CORS (should be the Vercel production URL) |
| `AI_PROVIDER` | Selects the AI provider: `anthropic` or `gemini` (optional — defaults to `anthropic`) |
| `ANTHROPIC_API_KEY` | Required only when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | Required only when `AI_PROVIDER=anthropic` — no hardcoded fallback |
| `GEMINI_API_KEY` | Required only when `AI_PROVIDER=gemini` |
| `GEMINI_MODEL` | Required only when `AI_PROVIDER=gemini` — no hardcoded fallback |
| `EMBEDDING_MODEL_CACHE_DIR` | Optional — where local embedding model weights are cached; should point at a persistent path in production if the platform provides one |
| `EMBEDDING_MODEL_WARMUP` | Optional — set to `true` to warm up the embedding model at startup |

### Vercel (frontend)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL the frontend calls for the backend API. Inlined into the browser bundle at build time — a change requires a rebuild, not just a dashboard edit, to take effect |
| `NEXT_PUBLIC_SITE_URL` | The frontend's own public site URL |

### GitHub Actions

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` (secret) | `db-migrate.yml` | Pooled Neon connection string, for `prisma migrate deploy` |
| `DATABASE_URL_UNPOOLED` (secret) | `db-migrate.yml` | Direct Neon connection string, for Prisma's `directUrl` during migration |

`ci.yml` (test/typecheck/build on every PR and push to `main`) uses only harmless, non-secret placeholder values for both client and server env vars — it never touches real credentials or a real database.

## 4. Deployment flow

Application deployment and database migration are **two separate, independently-triggered processes** — deploying new code never applies a schema change, and applying a schema change never deploys new code.

1. Changes are pushed to `phase-14-rag`.
2. Render deploys the backend automatically through its own configured Git integration (not via a GitHub Actions workflow — no deploy step exists in this repo).
3. Vercel deploys the frontend automatically through its own configured Git integration (likewise, no deploy step in this repo).
4. Database schema changes are **not** applied automatically by either platform deploying — a new migration file sitting in `server/prisma/migrations/` does nothing on its own until step 5 runs.
5. Production Prisma migrations are run manually and deliberately through GitHub Actions → `db-migrate.yml` (`workflow_dispatch` only — never automatic).
6. That migration run uses the `DATABASE_URL`/`DATABASE_URL_UNPOOLED` GitHub Secrets, never a value from Render or Vercel's own environment.
7. After any deploy, verify backend health/readiness (§7) before assuming the deploy succeeded.
8. Verify the frontend and key authenticated flows (§7) — a green build does not guarantee a working end-to-end flow.

## 5. GitHub Actions database migration

- **Workflow path**: `.github/workflows/db-migrate.yml`
- **Trigger**: `workflow_dispatch` only — must be run manually from the Actions tab; it never fires on a push or PR
- **Purpose**: runs `npx prisma migrate deploy`, which applies already-committed migration files from `server/prisma/migrations/` — it never generates new migrations and never touches `schema.prisma`
- **Node version**: read from the root `.nvmrc` via `actions/setup-node@v4`'s `node-version-file` input, same convention as `ci.yml`
- **Credentials**: `DATABASE_URL`/`DATABASE_URL_UNPOOLED` are supplied via GitHub Secrets, never printed or passed on the command line — Prisma reads them from the environment itself
- **Independence from Render/Vercel**: this workflow runs on a plain `ubuntu-latest` GitHub-hosted runner and has zero dependency on either platform's configuration — it would work identically even if the backend were hosted somewhere else entirely

## 6. Pre-deployment checklist

Before pushing to `phase-14-rag` (or triggering `db-migrate.yml`):

- [ ] Backend tests pass (`cd server && npm test`)
- [ ] Client tests pass (`cd client && npm test`)
- [ ] Backend TypeScript check passes (`cd server && npx tsc --noEmit`)
- [ ] Client TypeScript check passes (`cd client && npx tsc --noEmit`)
- [ ] Backend production build passes (`cd server && npm run build`)
- [ ] Client production build passes (`cd client && npm run build`)
- [ ] `git diff --check` passes (no whitespace/conflict-marker errors)
- [ ] `git status --short` reviewed — only the intended files are staged; protected/unrelated working-tree changes are not accidentally included (never stage with a blanket `git add .`/`git add -A`)
- [ ] If `server/prisma/schema.prisma` or `server/prisma/migrations/` changed, the migration has been reviewed (see §8) before assuming it's safe to run against production
- [ ] Required production environment variables (§3) exist and are current on both Render and Vercel — especially after adding a new one to code
- [ ] Confirm the branch actually being deployed is `phase-14-rag` (or whatever branch each platform's dashboard is currently configured to track)

## 7. Post-deployment verification

Keep this practical — a few real requests/flows, not an exhaustive test pass:

- `GET https://devpilot-ai-hf9u.onrender.com/api/v1/health` → `200`
- `GET https://devpilot-ai-hf9u.onrender.com/api/v1/ready` → `200` with `database: "ok"`
- Frontend loads at the production Vercel URL with no console errors
- Login and signup both work end-to-end (session cookie is set, redirect to `/dashboard` happens)
- An authenticated API request succeeds (e.g. the dashboard's project list loads)
- Project/task create, update, and delete all work
- Document create/edit/archive work, and a newly-created document's indexing status eventually moves from PENDING to READY (or FAILED, with the failure surfaced in the UI) rather than staying stuck
- AI chat sends a message and receives a streamed response
- An AI-proposed action (e.g. `createTask`) produces a pending-action card, and confirming it actually creates the task
- No unexpected 401 redirect loop — a logged-in session should not repeatedly bounce to `/login` (see the global 401 handling added in `client/lib/api.ts`, Phase 23 Step 1)
- Quick browser DevTools sanity check: no unexpected failed network requests, no CORS errors, no mixed-content warnings

## 8. Database migration procedure

For the detailed, step-by-step RAG-era migration procedure (including the pre-flight duplicate-check query and safety notes specific to that migration), see `docs/runbooks/rag-migration.md` — that document is not duplicated here.

In general: `db-migrate.yml` should be run whenever `server/prisma/migrations/` has a new, committed migration that hasn't yet been applied to the production database. Because it's `workflow_dispatch`-only, this is always a deliberate, explicit action taken by someone with repository Actions access — never something that happens as a side effect of merging code or deploying. Always review what a pending migration actually does (and, for anything touching existing data, whether it's safe against current production data) before triggering the workflow.

## 9. Rollback / recovery

There is no automated rollback system for either the application or the database — do not assume one exists.

- **Application rollback** (bad backend or frontend deploy): use Render's and Vercel's own deployment-history/rollback mechanisms in their respective dashboards to redeploy a previous known-good build. This repository has no rollback automation of its own.
- **Database rollback is a separate concern from application rollback.** Rolling back the deployed *code* does not undo a Prisma migration that already ran against production — the two must be reasoned about independently.
- **Do not casually roll back a Prisma migration by manually editing the production schema or database.** If a migration is implicated in an incident, first inspect the actual migration state (`prisma migrate status` against production, and the specific migration's SQL in `server/prisma/migrations/`) before taking any corrective action — understand exactly what already ran and what it did before attempting to reverse any part of it.

## 10. Deployment configuration ownership

To prevent a future developer from assuming infrastructure-as-code exists where it does not:

- **Source code, build scripts, and application configuration** live in this Git repository.
- **Render service configuration** (build/start commands, root directory, region, health-check target, env vars) is currently **dashboard-managed** — there is no `render.yaml` in this repository.
- **Vercel project configuration** (root directory, framework detection, env vars) is currently **dashboard-managed** — there is no `vercel.json` in this repository.
- **Neon configuration** (branches, connection pooling, region) is managed within Neon's own console.
- **Production database migrations** are manually triggered through GitHub Actions (`db-migrate.yml`) — never automatic, never a side effect of an application deploy.
- **`render.yaml` and `vercel.json` are intentionally not used at this time** (per the Phase 23 Step 2 investigation) — this is a deliberate current state, not an oversight, given the real risk that introducing either one incorrectly could silently overwrite already-correct live dashboard settings.

## 11. Future infrastructure improvements

Documented for awareness only — none of these are implemented, and none should be assumed to exist:

- A minimal `render.yaml` (env-var *names* only, `sync: false` for secrets, no build/start command overrides) — but only after the exact current Render dashboard configuration has been captured and independently verified, so any written blueprint matches reality instead of guessing at it.
- A minimal `vercel.json` — only if a concrete, specific need arises (e.g. a custom header or redirect rule); Vercel's zero-config Next.js detection already handles this app correctly today, so there is no reproducibility gap urgent enough to justify one yet.
- Structured, request-correlated backend logging (the backend currently only uses plain `console.log`/`console.error`, with no request-ID/correlation-ID and no structured/JSON log format).
- External error-reporting/monitoring integration (none exists today — no Sentry, Datadog, New Relic, or equivalent).
- Deployment automation improvements (e.g. a documented, deliberate decision about whether `db-migrate.yml` should ever become part of an automated release gate) — explicitly not recommended casually, since the workflow's manual-only trigger is itself a deliberate safety choice recorded in its own file comment.

A Dockerfile is **not** included in this list — there is no demonstrated requirement for one, and Render's native (non-Docker) Node runtime is what this project has been specifically tuned against (see the Phase 18 Prisma/Neon/OpenSSL investigation, which diagnosed and fixed behavior specific to that exact runtime).
