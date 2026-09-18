import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReindexArgs } from "./reindex-args";

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
