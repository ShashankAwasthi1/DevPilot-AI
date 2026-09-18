import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Router } from "express";

// Phase 27 Step 8: app.ts itself had no dedicated tests before this step.
// "./routes" is mocked with a trivial empty router so importing the real
// app.ts here never transitively constructs a real PrismaClient (every
// real route eventually reaches a controller/service that imports
// ../config/prisma) - this test genuinely exercises app.ts's own
// middleware setup (cors, json, cookieParser, trust proxy, the
// x-powered-by disable added in this step, error handlers), not the
// business logic behind any real route.

let importCounter = 0;
function importFreshApp() {
  return import(`./app?test=${importCounter++}`) as Promise<{ default: import("express").Express }>;
}

test("app: disables the X-Powered-By header on every response", async (t) => {
  t.mock.module("./routes", { defaultExport: Router() });

  const { default: app } = await importFreshApp();

  assert.equal(app.get("x-powered-by"), false, "x-powered-by must be disabled on the Express app itself");

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/does-not-exist`);
    assert.equal(res.headers.get("x-powered-by"), null, "no response may carry the X-Powered-By header");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
