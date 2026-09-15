import { test } from "node:test";
import assert from "node:assert/strict";
import { searchDocumentsTool } from "./search-documents.tool";

test("searchDocuments schema rejects a model-supplied projectId/userId (structural scoping guarantee)", () => {
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "auth", projectId: "some-other-project" }));
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "auth", userId: "someone-else" }));
});

test("searchDocuments schema enforces query length bounds (1-300)", () => {
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "" }));
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "a".repeat(301) }));
  assert.deepEqual(searchDocumentsTool.schema.parse({ query: "a".repeat(300) }), { query: "a".repeat(300) });
  assert.deepEqual(searchDocumentsTool.schema.parse({ query: "a" }), { query: "a" });
});

test("searchDocuments schema enforces limit bounds (1-5) and allows omission", () => {
  assert.deepEqual(searchDocumentsTool.schema.parse({ query: "x" }), { query: "x" });
  assert.deepEqual(searchDocumentsTool.schema.parse({ query: "x", limit: 5 }), { query: "x", limit: 5 });
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "x", limit: 0 }));
  assert.throws(() => searchDocumentsTool.schema.parse({ query: "x", limit: 6 }));
});
