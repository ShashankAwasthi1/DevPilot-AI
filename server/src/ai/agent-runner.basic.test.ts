import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

test("runAgentTurn: a plain text response with no tool use ends in exactly one done event", async (t) => {
  const { provider } = makeScriptedProvider(() => [
    { type: "text", text: "Hello there." },
    { type: "stop", reason: "end_turn" },
  ]);

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hi" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text", text: "Hello there." },
    { type: "done", text: "Hello there." },
  ]);
});
