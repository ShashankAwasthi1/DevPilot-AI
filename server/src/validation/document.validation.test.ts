import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocumentSchema, updateDocumentSchema } from "./document.validation";

// Phase 26 Step 7: proves indexStatus has no client-write path. Neither
// schema declares an `indexStatus` field, and (matching this file's own
// existing convention - see its module-level comment about projectId/
// createdById - a plain z.object(), not .strict()) any unknown field a
// caller sends is silently stripped rather than rejected, so a client can
// never influence indexStatus through the create/update request body,
// whether or not it also sends valid fields alongside it.

test("createDocumentSchema: an injected indexStatus field is silently stripped, never reaches CreateDocumentInput", () => {
  const parsed = createDocumentSchema.parse({
    title: "Runbook",
    content: "Restart the service.",
    indexStatus: "READY",
  });

  assert.deepEqual(Object.keys(parsed).sort(), ["content", "title"]);
  assert.equal((parsed as Record<string, unknown>).indexStatus, undefined);
});

test("updateDocumentSchema: an injected indexStatus field is silently stripped, never reaches UpdateDocumentInput", () => {
  const parsed = updateDocumentSchema.parse({
    title: "New title",
    indexStatus: "FAILED",
  });

  assert.deepEqual(Object.keys(parsed).sort(), ["title"]);
  assert.equal((parsed as Record<string, unknown>).indexStatus, undefined);
});

test("updateDocumentSchema: an update body containing ONLY indexStatus is rejected as a no-op (no recognized field was actually provided)", () => {
  assert.throws(() => updateDocumentSchema.parse({ indexStatus: "READY" }));
});
