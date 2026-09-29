import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Loads a gitignored, developer-local env file - never .env/.env.local
// (this app's own dev env), so this can never accidentally point at a
// real dev/production database or origin. See server/.env.e2e.example and
// client/.env.e2e.example for what's required and client/e2e/README.md
// for setup. process.loadEnvFile is Node's own built-in (Node 20.6+, this
// repo targets 22.x) - no dotenv dependency needed here.
function loadE2eEnv(absolutePath: string) {
  try {
    process.loadEnvFile(absolutePath);
  } catch (err) {
    // Missing file is expected until a developer copies the .example and
    // fills in real local values - surfaced later as a clear webServer
    // startup failure (e.g. "Missing required environment variable:
    // DATABASE_URL") rather than swallowed here.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

const clientDir = __dirname;
const serverDir = path.resolve(clientDir, "../server");

loadE2eEnv(path.join(serverDir, ".env.e2e"));
loadE2eEnv(path.join(clientDir, ".env.e2e"));

const FRONTEND_URL = "http://localhost:3000";
const BACKEND_URL = "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Sequential by design (not this project's default parallel behavior):
  // the backend's real signup limiter (5/15min/IP) and login limiter
  // (10/15min/IP) make concurrent workers a real risk of self-inflicted
  // 429s, and there's no per-test database isolation (single dedicated
  // local Postgres database, no transaction-per-test/reset strategy) -
  // see client/e2e/README.md.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // No video by default - trace-on-first-retry plus a failure
    // screenshot already cover debugging a flaky/failing run; video adds
    // real CI artifact size/time for marginal extra signal over the trace
    // viewer's own timeline+DOM snapshots.
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Starts both the real frontend and real backend against the dedicated
  // E2E database (via the env files loaded above) - reuseExistingServer
  // locally so a developer can leave `npm run dev` running in both
  // directories and just re-run tests, but never in CI (a stale/wrong
  // server must never be silently reused there).
  webServer: [
    {
      command: "npm run dev",
      cwd: serverDir,
      url: `${BACKEND_URL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "development",
        PORT: "8080",
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED ?? "",
        CORS_ORIGIN: process.env.CORS_ORIGIN ?? FRONTEND_URL,
        // AI chat isn't covered by this initial suite (see
        // client/e2e/README.md) - these are never validated unless a real
        // AI request is made, so harmless placeholders keep the server
        // bootable without requiring a real provider key just to run
        // auth/project/task E2E flows.
        AI_PROVIDER: process.env.AI_PROVIDER ?? "anthropic",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "e2e-placeholder-unused",
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
      },
    },
    {
      command: "npm run dev",
      cwd: clientDir,
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: "3000",
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? `${BACKEND_URL}/api/v1`,
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? FRONTEND_URL,
      },
    },
  ],
});
