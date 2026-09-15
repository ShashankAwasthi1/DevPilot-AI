import { test } from "node:test";
import assert from "node:assert/strict";

// One shared mock for the whole file, branching on the query text - this
// avoids re-mocking the same module target across test() blocks, which
// would not affect the already-cached search-documents.tool.ts module (see
// the tool-loop.*.test.ts files from Phase 13 for the same constraint).
let recordedArgs: unknown[] = [];

test("searchDocuments handler calls the retrieval service with exactly ToolContext's userId/projectId and returns a compact result", async (t) => {
  t.mock.module("../../services/document-retrieval.service", {
    namedExports: {
      retrieveRelevantChunks: async (...args: unknown[]) => {
        recordedArgs = args;
        if (args[2] === "trigger-failure") {
          throw new Error("simulated retrieval failure - internal detail that must not leak");
        }
        return [
          {
            documentId: "doc-1",
            documentTitle: "API Authentication Guide",
            chunkId: "chunk-1",
            chunkIndex: 0,
            content: "Use a Bearer token in the Authorization header.",
            distance: 0.08,
          },
        ];
      },
    },
  });

  const { searchDocumentsTool } = await import("./search-documents.tool");

  const result = (await searchDocumentsTool.handler(
    { query: "how do I authenticate?", limit: 2 },
    { userId: "u1", projectId: "p1" },
  )) as { result: unknown; sources: unknown };

  assert.deepEqual(recordedArgs, ["u1", "p1", "how do I authenticate?", 2]);

  // Model-facing result stays compact - only what the model needs, never
  // the embedding, ids, or distance score.
  assert.deepEqual(result.result, [
    { documentTitle: "API Authentication Guide", content: "Use a Bearer token in the Authorization header." },
  ]);

  // The separate, internal-only sources record (Phase 16 Step 5) - never
  // sent to the model, only ever read by tool-loop.ts's executeToolCall.
  assert.deepEqual(result.sources, [{ documentId: "doc-1", title: "API Authentication Guide" }]);
});

test("searchDocuments propagates a retrieval failure rather than masking it (tool-loop's existing generic handling applies)", async () => {
  // No second t.mock.module call here on purpose: search-documents.tool.ts
  // was already imported (and cached) by the previous test, bound to the
  // mock registered there - re-mocking the same specifier now would not
  // affect that already-loaded module. The shared mock's "trigger-failure"
  // branch (registered above) is what this test actually exercises.
  const { searchDocumentsTool } = await import("./search-documents.tool");

  await assert.rejects(() =>
    searchDocumentsTool.handler({ query: "trigger-failure" }, { userId: "u1", projectId: "p1" }),
  );
});
