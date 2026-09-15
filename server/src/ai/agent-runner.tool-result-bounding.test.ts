import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AI_LIMITS } from "./limits";
import { makeScriptedProvider } from "./fixtures";
import type { ProviderContentBlock } from "./provider";

const bigResultTool = {
  name: "bigResultTool",
  description: "test tool returning an oversized array",
  schema: z.object({}).strict(),
  handler: async () => Array.from({ length: 500 }, (_, i) => ({ index: i, text: "x".repeat(50) })),
};

test("runAgentTurn: an oversized tool result is bounded via the shared buildToolResultBlock/boundToolResult mechanism, not a new algorithm", async (t) => {
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [{ type: "tool_use", id: "c1", name: "bigResultTool", input: {} }, { type: "stop", reason: "tool_use" }];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [bigResultTool] } });

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

  assert.deepEqual(
    events.find((e) => e.type === "tool_result"),
    { type: "tool_result", name: "bigResultTool", ok: true },
  );

  const lastUser = [...calls[1].params.messages].reverse().find((m) => m.role === "user");
  assert.ok(lastUser && typeof lastUser.content !== "string");
  const toolResultBlock = (lastUser!.content as ProviderContentBlock[]).find((b) => b.type === "tool_result");
  assert.ok(toolResultBlock && toolResultBlock.type === "tool_result");
  assert.ok((toolResultBlock as { content: string }).content.length <= AI_LIMITS.MAX_TOOL_RESULT_CHARS);
});
