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

test("a client disconnect mid-stream stops the loop without a done event or further tool work", async (t) => {
  const controller = new AbortController();

  // Yields one text delta, then simulates the SDK's real behavior of
  // throwing once the caller's AbortSignal fires mid-generation.
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
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: controller.signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "text", text: "partial" }], "only the text received before the abort should be yielded");
  assert.ok(!events.some((e) => e.type === "done"), "no done event should be yielded for an aborted turn");
  assert.ok(!events.some((e) => e.type === "tool_call"), "no tool work should start after an abort");
});
