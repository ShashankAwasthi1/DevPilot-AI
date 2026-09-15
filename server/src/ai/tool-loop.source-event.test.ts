import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const searchDocumentsTool = {
  name: "searchDocuments",
  description: "test",
  schema: z.object({ query: z.string() }).strict(),
  handler: async () => ({
    result: [{ documentTitle: "API Authentication Guide", content: "Use a Bearer token." }],
    sources: [{ documentId: "doc-1", title: "API Authentication Guide" }],
  }),
};

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

test("runChatTurn: a successful searchDocuments call yields a source event with only documentId+title; other tools never do", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "searchDocuments", input: { query: "auth" } },
        { type: "tool_use", id: "c2", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [searchDocumentsTool, getTasksTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  const sourceEvents = events.filter((e) => e.type === "source");
  assert.equal(sourceEvents.length, 1, "exactly one source event for the one searchDocuments call, none for getTasks");
  assert.deepEqual(sourceEvents[0], {
    type: "source",
    sources: [{ documentId: "doc-1", title: "API Authentication Guide" }],
  });

  // The source event must appear after searchDocuments' own tool_result,
  // and getTasks' tool_result must never be followed by one.
  const toolResultIndex = events.findIndex((e) => e.type === "tool_result" && e.name === "searchDocuments");
  const sourceIndex = events.findIndex((e) => e.type === "source");
  assert.ok(toolResultIndex !== -1 && sourceIndex > toolResultIndex);
});
