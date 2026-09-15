import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { AIProvider, StreamEvent } from "./provider";

test("runAgentTurn: a caller disconnect mid-stream stops the run silently, with no done, no error, and no further tool work", async (t) => {
  let toolExecuted = false;
  const failIfCalledTool = {
    name: "echoTool",
    description: "test tool",
    schema: z.object({}).strict(),
    handler: async () => {
      toolExecuted = true;
      return { ok: true };
    },
  };

  const controller = new AbortController();

  // Yields one text delta, then simulates the real SDK's behavior of
  // throwing once the caller's (here, internal) AbortSignal fires
  // mid-generation.
  const provider: AIProvider = {
    name: "fake",
    async *streamTurn(params): AsyncGenerator<StreamEvent> {
      yield { type: "text", text: "partial" };
      controller.abort(); // simulate the client disconnecting right now
      if (params.signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
    },
  };

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [failIfCalledTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: controller.signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "text", text: "partial" }], "only the text received before the abort should be yielded");
  assert.ok(!events.some((e) => e.type === "done"), "no done event should be yielded for an aborted turn");
  assert.ok(!events.some((e) => e.type === "error"), "client disconnect must never surface as an error event");
  assert.equal(toolExecuted, false, "no tool work should start after an abort");
});
