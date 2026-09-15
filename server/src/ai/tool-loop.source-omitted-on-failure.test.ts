import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const failingSearchDocumentsTool = {
  name: "searchDocuments",
  description: "test",
  schema: z.object({ query: z.string() }).strict(),
  handler: async () => {
    throw new Error("simulated retrieval failure");
  },
};

test("runChatTurn: a failed searchDocuments call never yields a source event", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "searchDocuments", input: { query: "auth" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "I could not search documentation." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [failingSearchDocumentsTool] } });

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

  assert.ok(!events.some((e) => e.type === "source"), "a failed tool call must never produce a source event");
  const toolResult = events.find((e) => e.type === "tool_result");
  assert.deepEqual(toolResult, { type: "tool_result", name: "searchDocuments", ok: false });
});
