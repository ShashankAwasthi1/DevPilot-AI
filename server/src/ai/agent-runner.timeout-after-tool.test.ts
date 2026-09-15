import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const slowTool = {
  name: "slowTool",
  description: "test tool that takes longer than the configured timeout",
  schema: z.object({}).strict(),
  handler: async () => {
    // Tool handlers do not accept an AbortSignal in this phase, so this
    // await cannot be interrupted - it must be allowed to finish naturally.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { ok: true };
  },
};

test("runAgentTurn: a timeout that fires while a tool handler is in flight is detected immediately afterward, with no further tool or round", async (t) => {
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [{ type: "tool_use", id: "c1", name: "slowTool", input: {} }, { type: "stop", reason: "tool_use" }];
    }
    return [{ type: "text", text: "should never run" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [slowTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
    limits: { timeoutMs: 20 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "tool_call", name: "slowTool", input: {} },
    { type: "error", reason: "timeout" },
  ]);
  assert.equal(calls.length, 1, "no second provider round must start after the timeout fires during tool execution");
});
