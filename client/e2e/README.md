# E2E tests (Playwright)

Minimal Playwright suite covering the smallest set of critical, deterministic
user journeys identified in PHASE 26 Step 1's investigation: signup → login →
dashboard, session-expiry redirect, project creation, task creation/update,
and logout. AI chat and pending-action confirmation are intentionally **not**
covered here - see that investigation for why (no mock AI provider exists,
and real-provider E2E coverage would be slow/flaky/costly).

Uses the **real** signup/login UI and a **real**, dedicated local PostgreSQL
database - no auth bypass, no mocked backend, no production database or
credentials of any kind.

## One-time setup

### 1. Create a dedicated local E2E database

Use a database that exists **only** for E2E runs - never your normal local
dev database, and never the production Neon database.

```bash
createdb devpilot_e2e
```

The schema uses the Postgres `vector` extension (pgvector), so your local
Postgres server must have it installed and available to `CREATE EXTENSION`
(the migration that creates it is already committed - see
`server/prisma/migrations/20260914235424_add_document_chunks_pgvector/migration.sql`).
On most platforms this means installing the `pgvector` extension package for
your Postgres server first (e.g. `brew install pgvector` on macOS with
Postgres.app/Homebrew Postgres, or your distro's `postgresql-<version>-pgvector`
package on Linux) - consult pgvector's own installation instructions for your
setup if `CREATE EXTENSION vector` fails in the next step.

### 2. Create your local env files

```bash
cp server/.env.e2e.example server/.env.e2e
cp client/.env.e2e.example client/.env.e2e
```

Edit `server/.env.e2e` and point `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at
the database you just created. Both files are already gitignored (matching
every other `.env*` file in this repo) - never commit real values.

### 3. Apply migrations to the E2E database

`prisma migrate deploy` only applies already-committed migration files - it
never generates new migrations, never touches `schema.prisma`, and is safe
to run against a fresh database. This is **not** wired into any npm script
on purpose, so it can never run against the wrong `DATABASE_URL` by
accident - run it explicitly, once, pointed at the E2E database only:

```bash
cd server
set -a; source .env.e2e; set +a
npx prisma migrate deploy
set +a
```

Re-run this whenever a new migration is added to `server/prisma/migrations/`.

### 4. Install Playwright's browser binary (one time)

```bash
cd client
npx playwright install chromium
```

## Running the suite

```bash
cd client
npm run test:e2e       # headless run
npm run test:e2e:ui    # Playwright's interactive UI mode
```

`playwright.config.ts` starts both the frontend (`next dev` on `:3000`) and
the backend (`tsx watch` on `:8080`, using `server/.env.e2e`) automatically -
no need to start either process yourself first. Locally it will reuse
already-running dev servers on those ports if you have them open; in CI it
always starts fresh ones (not currently wired into CI - see PHASE 26 Step 2A).

## Design notes / constraints

- **Sequential, single worker.** The backend's real signup limiter
  (5 signups / 15 min / IP) and login limiter (10 logins / 15 min / IP) make
  parallel workers a real risk of self-inflicted `429`s, and there is no
  per-test database transaction/reset strategy - see `playwright.config.ts`.
- **Two signups per full run, not one per test.** `e2e/fixtures.ts`'s
  `sharedAccount` fixture signs up one throwaway account once per worker,
  reused (via a fresh login) by every test that just needs to be signed in;
  `auth.spec.ts`'s own signup test creates a second, separate account, since
  it exists specifically to exercise that flow. Re-running the full suite
  repeatedly within the same 15-minute window can still approach the
  signup limiter - this is an accepted local-iteration tradeoff, not a bug.
- **Test data is namespaced, not reset.** Every generated email/project/task
  name includes `uniqueId()` (timestamp + random suffix), so tests never
  depend on the database being empty or on a previous run's data being gone.
  There is no automatic database reset between runs.
- **No shared mutable session across tests.** Every test gets its own fresh
  browser context via the `authedPage` fixture (a new login each time), so a
  test that clears cookies or signs out can never affect another test.
