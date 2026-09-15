import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { AIProvider } from "./provider";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

test("runAgentTurn: a genuine provider failure yields exactly one provider_error event, never a done, and never leaks the raw error", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  const provider: AIProvider = {
    name: "fake",
    async *streamTurn() {
      throw new Error("simulated network failure - internal detail that must never reach the browser");
    },
  };

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

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

  assert.deepEqual(events, [{ type: "error", reason: "provider_error" }]);
  assert.ok(!JSON.stringify(events).includes("simulated network failure"), "the raw provider error must never appear in an emitted event");
  assert.equal(errorLogs.length, 1, "the failure must still be logged server-side");
});
