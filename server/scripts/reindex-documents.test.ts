import { test } from "node:test";
import assert from "node:assert/strict";

// reindex-documents.ts runs main() unconditionally at module scope (it's
// a CLI script, not an importable library) - each test here mutates
// process.argv before importing a fresh copy of the module (cache-busted,
// same convention used throughout this codebase's test suite for
// t.mock.module isolation) and restores process.argv/process.exitCode
// afterward, so one test's "failure" exit code never leaks into the
// overall test run's own exit code.
let importCounter = 0;
function importFreshScript() {
  return import(`./reindex-documents?test=${importCounter++}`);
}

interface FakePrismaOptions {
  findManyImpl?: (args: unknown) => Promise<{ id: string }[]>;
}

function makeFakePrisma(options: FakePrismaOptions = {}) {
  const findManyCalls: unknown[] = [];
  let resolveDisconnected: () => void;
  const disconnected = new Promise<void>((resolve) => {
    resolveDisconnected = resolve;
  });

  const prisma = {
    document: {
      findMany: async (args: unknown) => {
        findManyCalls.push(args);
        return options.findManyImpl ? options.findManyImpl(args) : [];
      },
    },
    // main()'s own .finally(() => prisma.$disconnect()) is the signal
    // this fake uses to tell a test "main() has fully settled" - awaiting
    // `disconnected` is more reliable than awaiting the dynamic import
    // itself, since main() runs as a detached promise chain, not
    // something the module's own import resolution waits on.
    $disconnect: async () => {
      resolveDisconnected();
    },
  };

  return { prisma, findManyCalls, disconnected };
}

async function runScript(
  argv: string[],
  options: { findManyImpl?: (args: unknown) => Promise<{ id: string }[]>; indexDocument?: (id: string) => Promise<void> },
  t: import("node:test").TestContext,
): Promise<{ findManyCalls: unknown[]; logs: string[]; errors: string[]; exitCode: number | undefined }> {
  const { prisma, findManyCalls, disconnected } = makeFakePrisma({ findManyImpl: options.findManyImpl });

  t.mock.module("../src/config/prisma", { namedExports: { prisma } });
  t.mock.module("../src/services/document-indexing.service", {
    namedExports: { indexDocument: options.indexDocument ?? (async () => {}) },
  });

  const logs: string[] = [];
  const errors: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  process.argv = ["node", "reindex-documents.js", ...argv];

  let observedExitCode: number | undefined;
  try {
    await importFreshScript();
    await disconnected;
    // Captured before restoring - this is the exit code the real CLI
    // invocation would actually have produced for these args.
    observedExitCode = process.exitCode;
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }

  return { findManyCalls, logs, errors, exitCode: observedExitCode };
}

// --- existing behavior, unchanged by the new flag --------------------------

test("no flags: the where clause is exactly the pre-existing shape (archivedAt: null only), no updatedAt filter", async (t) => {
  const { findManyCalls } = await runScript([], {}, t);

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(findManyCalls[0], { where: { archivedAt: null }, select: { id: true } });
});

test("--status=FAILED alone: unchanged existing filter shape, no updatedAt filter", async (t) => {
  const { findManyCalls } = await runScript(["--status=FAILED"], {}, t);

  assert.deepEqual(findManyCalls[0], {
    where: { archivedAt: null, indexStatus: "FAILED" },
    select: { id: true },
  });
});

test("--project=<id> alone: unchanged existing filter shape, no updatedAt filter", async (t) => {
  const { findManyCalls } = await runScript(["--project=project-123"], {}, t);

  assert.deepEqual(findManyCalls[0], {
    where: { archivedAt: null, projectId: "project-123" },
    select: { id: true },
  });
});

test("--status=PENDING alone (no stale-age flag): unchanged existing filter shape, no updatedAt filter", async (t) => {
  const { findManyCalls } = await runScript(["--status=PENDING"], {}, t);

  assert.deepEqual(findManyCalls[0], {
    where: { archivedAt: null, indexStatus: "PENDING" },
    select: { id: true },
  });
});

// --- the new stale-age filter -----------------------------------------------

test("--status=PENDING --stale-after-minutes=10: adds an updatedAt < cutoff clause alongside the existing filters", async (t) => {
  const before = Date.now();
  const { findManyCalls } = await runScript(["--status=PENDING", "--stale-after-minutes=10"], {}, t);
  const after = Date.now();

  assert.equal(findManyCalls.length, 1);
  const where = (findManyCalls[0] as { where: Record<string, unknown> }).where;
  assert.equal(where.archivedAt, null);
  assert.equal(where.indexStatus, "PENDING");
  assert.ok(where.updatedAt, "an updatedAt filter must be present");
  const cutoff = (where.updatedAt as { lt: Date }).lt;
  assert.ok(cutoff instanceof Date);
  // The cutoff is "now - 10 minutes", computed at call time - bounded
  // against the real wall-clock window this test ran in.
  assert.ok(cutoff.getTime() >= before - 10 * 60_000);
  assert.ok(cutoff.getTime() <= after - 10 * 60_000);
});

test("--status=PENDING --stale-after-minutes=10 --project=<id>: all three filters combine correctly", async (t) => {
  const { findManyCalls } = await runScript(
    ["--status=PENDING", "--project=project-123", "--stale-after-minutes=10"],
    {},
    t,
  );

  const where = (findManyCalls[0] as { where: Record<string, unknown> }).where;
  assert.equal(where.archivedAt, null);
  assert.equal(where.indexStatus, "PENDING");
  assert.equal(where.projectId, "project-123");
  assert.ok(where.updatedAt);
});

test("the CLI output clearly states the stale-age filter is active, including the exact threshold", async (t) => {
  const { logs } = await runScript(["--status=PENDING", "--stale-after-minutes=10"], {}, t);

  assert.ok(
    logs.some((line) => line.includes("Stale-age filter active") && line.includes("10 minute(s)")),
    "the announcement must name the threshold explicitly",
  );
});

test("without the stale-age flag, no such announcement is printed", async (t) => {
  const { logs } = await runScript(["--status=PENDING"], {}, t);

  assert.ok(!logs.some((line) => line.includes("Stale-age filter active")));
});

test("the summary line's filter description includes stale-after-minutes when the flag is used", async (t) => {
  const { logs } = await runScript(["--status=PENDING", "--stale-after-minutes=10"], {}, t);

  assert.ok(logs.some((line) => line.includes("Found 0 non-archived document(s)") && line.includes("stale-after-minutes=10")));
});

// --- validation failures never reach the database ---------------------------

test("--stale-after-minutes=0 fails before any database call, with a non-zero exit code", async (t) => {
  const { findManyCalls, errors, exitCode } = await runScript(["--status=PENDING", "--stale-after-minutes=0"], {}, t);

  assert.equal(findManyCalls.length, 0, "an invalid argument must never reach prisma.document.findMany");
  assert.ok(errors.some((line) => line.includes("Invalid --stale-after-minutes value")));
  assert.equal(exitCode, 1);
});

test("indexing still proceeds normally for whatever documents the stale-age query returns", async (t) => {
  const indexed: string[] = [];
  const { findManyCalls } = await runScript(
    ["--status=PENDING", "--stale-after-minutes=10"],
    {
      findManyImpl: async () => [{ id: "doc-stuck-1" }, { id: "doc-stuck-2" }],
      indexDocument: async (id: string) => {
        indexed.push(id);
      },
    },
    t,
  );

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(indexed, ["doc-stuck-1", "doc-stuck-2"], "existing sequential indexing behavior is unaffected");
});
