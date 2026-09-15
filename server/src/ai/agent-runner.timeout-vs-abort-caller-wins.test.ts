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

test("runAgentTurn: when the caller aborts well before the timeout would fire, the abort wins and the run stays silent", async (t) => {
  const { provider } = makeHangingProvider();

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const controller = new AbortController();
  const abortHandle = setTimeout(() => controller.abort(), 10);
  t.after(() => clearTimeout(abortHandle));

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: controller.signal,
    limits: { timeoutMs: 200 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [], "a caller abort that genuinely happens first must never surface as an error event");
});
