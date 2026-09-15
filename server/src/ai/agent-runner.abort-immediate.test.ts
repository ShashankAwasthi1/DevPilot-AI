import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { AIProvider, StreamEvent } from "./provider";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

test("runAgentTurn: an already-aborted caller signal stops the run before any provider call, with no events at all", async (t) => {
  let streamTurnCalls = 0;
  const provider: AIProvider = {
    name: "fake",
    async *streamTurn(): AsyncGenerator<StreamEvent> {
      streamTurnCalls++;
      yield { type: "text", text: "should never be seen" };
    },
  };

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const controller = new AbortController();
  controller.abort();

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: controller.signal,
  })) {
    events.push(event);
  }

  assert.equal(streamTurnCalls, 0, "an already-aborted signal must prevent any provider call");
  assert.equal(events.length, 0, "no events should be yielded once already aborted");
});
