import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const searchDocumentsTool = {
  name: "searchDocuments",
  description: "test",
  schema: z.object({ query: z.string() }).strict(),
  handler: async () => ({
    result: [{ documentTitle: "Project Architecture", content: "The system uses..." }],
    sources: [{ documentId: "doc-9", title: "Project Architecture" }],
  }),
};

test("runAgentTurn: a successful searchDocuments call yields a source event with only documentId+title", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "searchDocuments", input: { query: "architecture" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Based on the docs..." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [searchDocumentsTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  const sourceEvents = events.filter((e) => e.type === "source");
  assert.equal(sourceEvents.length, 1);
  assert.deepEqual(sourceEvents[0], {
    type: "source",
    sources: [{ documentId: "doc-9", title: "Project Architecture" }],
  });
});
