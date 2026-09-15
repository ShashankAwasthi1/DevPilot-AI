import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeHangingProvider } from "./fixtures";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

test("runAgentTurn: a timeout that fires mid-stream keeps the text received so far, then yields exactly one timeout error", async (t) => {
  const { provider } = makeHangingProvider({ textBeforeHang: "partial answer" });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
    limits: { timeoutMs: 30 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text", text: "partial answer" },
    { type: "error", reason: "timeout" },
  ]);
});
