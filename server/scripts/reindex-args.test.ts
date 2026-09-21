import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStaleCutoff, parseReindexArgs } from "./reindex-args";

// Phase 27 Step 5: parseReindexArgs is pure and dependency-free (no
// Prisma/indexDocument import anywhere in reindex-args.ts), so every case
// here runs with no database and no mocking at all.

test("no arguments: default/all (no status, no project filter)", () => {
  const result = parseReindexArgs([]);

  assert.deepEqual(result, { ok: true, args: {} });
});

test("--status=FAILED: parses a valid status filter", () => {
  const result = parseReindexArgs(["--status=FAILED"]);

  assert.deepEqual(result, { ok: true, args: { status: "FAILED" } });
});

test("--status=PENDING: parses a valid status filter", () => {
  const result = parseReindexArgs(["--status=PENDING"]);

  assert.deepEqual(result, { ok: true, args: { status: "PENDING" } });
});

test("--status=READY: parses a valid status filter", () => {
  const result = parseReindexArgs(["--status=READY"]);

  assert.deepEqual(result, { ok: true, args: { status: "READY" } });
});

test("--project=<id>: parses a project filter", () => {
  const result = parseReindexArgs(["--project=project-123"]);

  assert.deepEqual(result, { ok: true, args: { projectId: "project-123" } });
});

test("--status and --project combined: both filters are captured together", () => {
  const result = parseReindexArgs(["--status=FAILED", "--project=project-123"]);

  assert.deepEqual(result, { ok: true, args: { status: "FAILED", projectId: "project-123" } });
});

test("combined filters accept either argument order", () => {
  const result = parseReindexArgs(["--project=project-123", "--status=READY"]);

  assert.deepEqual(result, { ok: true, args: { status: "READY", projectId: "project-123" } });
});

test("an invalid --status value fails clearly, without touching the database (no side effects at all - this is a pure function)", () => {
  const result = parseReindexArgs(["--status=BOGUS"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Invalid --status value "BOGUS"/);
    assert.match(result.error, /FAILED, PENDING, READY/);
  }
});

test("--status is case-sensitive: lowercase 'failed' is rejected, not silently normalized", () => {
  const result = parseReindexArgs(["--status=failed"]);

  assert.equal(result.ok, false);
});

test("an empty --project value is rejected", () => {
  const result = parseReindexArgs(["--project="]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /must not be empty/);
  }
});

test("an unrecognized argument is rejected clearly", () => {
  const result = parseReindexArgs(["--bogus-flag=value"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unrecognized argument/);
  }
});

test("a valid flag followed by an unrecognized one still fails overall (all-or-nothing parsing)", () => {
  const result = parseReindexArgs(["--status=FAILED", "--typo=oops"]);

  assert.equal(result.ok, false);
});

// --- Phase 16D (C1): --stale-after-minutes ---------------------------------

test("--status=PENDING --stale-after-minutes=10: parses both together", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=10"]);

  assert.deepEqual(result, { ok: true, args: { status: "PENDING", staleAfterMinutes: 10 } });
});

test("--stale-after-minutes accepts either argument order relative to --status=PENDING", () => {
  const result = parseReindexArgs(["--stale-after-minutes=5", "--status=PENDING"]);

  assert.deepEqual(result, { ok: true, args: { status: "PENDING", staleAfterMinutes: 5 } });
});

test("--stale-after-minutes combines with --project as well as --status=PENDING", () => {
  const result = parseReindexArgs(["--status=PENDING", "--project=project-123", "--stale-after-minutes=10"]);

  assert.deepEqual(result, {
    ok: true,
    args: { status: "PENDING", projectId: "project-123", staleAfterMinutes: 10 },
  });
});

test("--stale-after-minutes accepts a fractional value", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=0.5"]);

  assert.deepEqual(result, { ok: true, args: { status: "PENDING", staleAfterMinutes: 0.5 } });
});

test("--stale-after-minutes=0 is rejected (zero is not a positive threshold)", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=0"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Invalid --stale-after-minutes value "0"/);
    assert.match(result.error, /finite positive number/);
  }
});

test("--stale-after-minutes=-5 (negative) is rejected", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=-5"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Invalid --stale-after-minutes value "-5"/);
  }
});

test("--stale-after-minutes=abc (non-numeric) is rejected", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=abc"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Invalid --stale-after-minutes value "abc"/);
  }
});

test("--stale-after-minutes=Infinity (non-finite) is rejected", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes=Infinity"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Invalid --stale-after-minutes value "Infinity"/);
  }
});

test("--stale-after-minutes= (empty value) is rejected", () => {
  const result = parseReindexArgs(["--status=PENDING", "--stale-after-minutes="]);

  assert.equal(result.ok, false);
});

test("--stale-after-minutes without --status=PENDING is rejected (no implicit status, and no silent no-op)", () => {
  const result = parseReindexArgs(["--stale-after-minutes=10"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /requires --status=PENDING/);
  }
});

test("--stale-after-minutes with --status=FAILED is rejected - the age filter is only for stuck PENDING recovery", () => {
  const result = parseReindexArgs(["--status=FAILED", "--stale-after-minutes=10"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /requires --status=PENDING/);
  }
});

test("--stale-after-minutes with --status=READY is rejected", () => {
  const result = parseReindexArgs(["--status=READY", "--stale-after-minutes=10"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /requires --status=PENDING/);
  }
});

test("the unrecognized-argument error message mentions --stale-after-minutes as a supported flag", () => {
  const result = parseReindexArgs(["--bogus-flag=value"]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /--stale-after-minutes=<n>/);
  }
});

// --- computeStaleCutoff: pure date-math, deterministic boundary behavior ---

test("computeStaleCutoff: subtracts exactly n minutes from the given `now`", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");
  const cutoff = computeStaleCutoff(10, now);

  assert.equal(cutoff.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("computeStaleCutoff: a document updated exactly at the cutoff instant is NOT older than it (strict `<` semantics belong to the caller's query, not this function, but the boundary value itself must be exact)", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");
  const cutoff = computeStaleCutoff(10, now);
  const documentUpdatedAt = new Date("2026-01-01T00:00:00.000Z");

  assert.equal(cutoff.getTime(), documentUpdatedAt.getTime(), "exactly-at-cutoff must compare equal, not less-than or greater-than");
});

test("computeStaleCutoff: supports fractional minutes precisely", () => {
  const now = new Date("2026-01-01T00:00:30.000Z");
  const cutoff = computeStaleCutoff(0.5, now);

  assert.equal(cutoff.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("computeStaleCutoff: defaults `now` to the real current time when omitted", () => {
  const before = Date.now();
  const cutoff = computeStaleCutoff(10);
  const after = Date.now();

  // cutoff must land within [before - 10min, after - 10min] - a loose
  // bound since real wall-clock time elapses between the two Date.now()
  // calls, but still tight enough to prove `now` really defaults to "now",
  // not some fixed/frozen value.
  assert.ok(cutoff.getTime() >= before - 10 * 60_000);
  assert.ok(cutoff.getTime() <= after - 10 * 60_000);
});
