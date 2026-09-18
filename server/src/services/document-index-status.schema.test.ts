import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase 26 Step 7: the DocumentIndexStatus migration is intentionally left
// unapplied throughout this whole phase (see every prior step's report),
// so none of this can be verified against a live database. These tests
// instead verify the schema/migration SOURCE TEXT directly - the only
// testable proxy available without applying it. They read the actual
// files on disk (never a copy/paraphrase), so they fail loudly if either
// file is ever edited in a way that breaks the documented contract.

const schemaPath = join(__dirname, "../../prisma/schema.prisma");
const migrationPath = join(
  __dirname,
  "../../prisma/migrations/20260918100000_add_document_index_status/migration.sql",
);

const schemaText = readFileSync(schemaPath, "utf-8");
const migrationText = readFileSync(migrationPath, "utf-8");

test("schema.prisma: DocumentIndexStatus enum exists with exactly PENDING, READY, FAILED", () => {
  const match = schemaText.match(/enum DocumentIndexStatus \{([\s\S]*?)\}/);
  assert.ok(match, "DocumentIndexStatus enum must exist in schema.prisma");

  const values = match![1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

  assert.deepEqual(values, ["PENDING", "READY", "FAILED"]);
});

test("schema.prisma: Document.indexStatus is typed DocumentIndexStatus and defaults to PENDING", () => {
  assert.match(
    schemaText,
    /indexStatus\s+DocumentIndexStatus\s+@default\(PENDING\)/,
    "Document.indexStatus must be declared as DocumentIndexStatus with @default(PENDING)",
  );
});

test("migration.sql: creates the DocumentIndexStatus enum with exactly PENDING, READY, FAILED", () => {
  assert.match(
    migrationText,
    /CREATE TYPE "DocumentIndexStatus" AS ENUM \('PENDING', 'READY', 'FAILED'\);/,
  );
});

test("migration.sql: adds the indexStatus column with a NOT NULL column default of PENDING", () => {
  assert.match(
    migrationText,
    /ADD COLUMN "indexStatus" "DocumentIndexStatus" NOT NULL DEFAULT 'PENDING'/,
  );
});

test("migration.sql: explicitly backfills existing rows to READY via a separate UPDATE statement, never via the column default itself", () => {
  assert.match(migrationText, /UPDATE "documents"\s+SET "indexStatus" = 'READY'/);

  // The backfill value must differ from the column's own ongoing default
  // (PENDING) - this is the whole point of using a separate UPDATE rather
  // than DEFAULT 'READY' on the ADD COLUMN itself (see the migration's own
  // comment): existing rows get READY, but every future insert that omits
  // the field still gets PENDING, matching schema.prisma's @default.
  const columnDefaultMatch = migrationText.match(/ADD COLUMN "indexStatus" "DocumentIndexStatus" NOT NULL DEFAULT '(\w+)'/);
  const backfillMatch = migrationText.match(/UPDATE "documents"\s+SET "indexStatus" = '(\w+)'/);
  assert.ok(columnDefaultMatch && backfillMatch);
  assert.notEqual(columnDefaultMatch![1], backfillMatch![1]);
  assert.equal(columnDefaultMatch![1], "PENDING");
  assert.equal(backfillMatch![1], "READY");
});

test("migration.sql: introduces no trigger and no index on indexStatus, per the locked design", () => {
  assert.equal(/CREATE\s+TRIGGER/i.test(migrationText), false, "no trigger should be introduced");
  assert.equal(/CREATE\s+INDEX/i.test(migrationText), false, "no index should be introduced");
});
