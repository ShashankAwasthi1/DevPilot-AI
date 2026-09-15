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

test("runAgentTurn: when the timeout fires well before a scheduled-but-later caller abort, the timeout wins with exactly one error event", async (t) => {
  const { provider } = makeHangingProvider();

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const controller = new AbortController();
  // Scheduled well after the timeout fires - proves the timeout path and
  // an armed-but-not-yet-fired caller abort listener don't cross-contaminate.
  const laterAbort = setTimeout(() => controller.abort(), 500);
  t.after(() => clearTimeout(laterAbort));

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: controller.signal,
    limits: { timeoutMs: 20 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "error", reason: "timeout" }]);
});
