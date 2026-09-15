import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDocumentSources, type ToolExecutionResult } from "./tool-loop";
import type { ToolDefinition } from "./tools/types";

// Plain unit tests for the shared extractDocumentSources helper - no
// module mocking needed since it's a pure function of its two arguments.

const searchDocumentsTool: ToolDefinition<any> = {
  name: "searchDocuments",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => ({ result: [], sources: [] }),
};

const otherTool: ToolDefinition<any> = {
  name: "getTasks",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => [],
};

test("extractDocumentSources: deduplicates by documentId and preserves first-seen order", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: [],
    sources: [
      { documentId: "doc-2", title: "Project Architecture" },
      { documentId: "doc-1", title: "API Authentication Guide" },
      { documentId: "doc-2", title: "Project Architecture (duplicate chunk)" },
    ],
  };

  assert.deepEqual(extractDocumentSources(searchDocumentsTool, executionResult), [
    { documentId: "doc-2", title: "Project Architecture" },
    { documentId: "doc-1", title: "API Authentication Guide" },
  ]);
});

test("extractDocumentSources: returns [] for any tool other than searchDocuments", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: [],
    sources: [{ documentId: "doc-1", title: "Should never surface" }],
  };

  assert.deepEqual(extractDocumentSources(otherTool, executionResult), []);
});

test("extractDocumentSources: returns [] for a failed execution", () => {
  const executionResult: ToolExecutionResult = { ok: false };
  assert.deepEqual(extractDocumentSources(searchDocumentsTool, executionResult), []);
});

test("extractDocumentSources: returns [] when the successful result carries no sources at all", () => {
  const executionResult: ToolExecutionResult = { ok: true, result: [] };
  assert.deepEqual(extractDocumentSources(searchDocumentsTool, executionResult), []);
});

test("extractDocumentSources: defensively drops malformed entries", () => {
  const executionResult = {
    ok: true,
    result: [],
    sources: [
      { documentId: "", title: "Empty documentId" },
      { documentId: "doc-1", title: "" },
      { documentId: 123, title: "Non-string documentId" },
      { documentId: "doc-2" },
      null,
      { documentId: "doc-3", title: "Valid entry" },
    ],
  } as unknown as ToolExecutionResult;

  assert.deepEqual(extractDocumentSources(searchDocumentsTool, executionResult), [
    { documentId: "doc-3", title: "Valid entry" },
  ]);
});

test("extractDocumentSources: returned entries contain only documentId and title", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: [],
    sources: [{ documentId: "doc-1", title: "API Authentication Guide" }],
  };

  const [source] = extractDocumentSources(searchDocumentsTool, executionResult);
  assert.deepEqual(Object.keys(source).sort(), ["documentId", "title"]);
});
