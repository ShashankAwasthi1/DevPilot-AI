import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AI_LIMITS } from "./limits";
import { makeScriptedProvider } from "./fixtures";

// A fixed, valid fake tool - present so the loop has something legitimate
// to call when the (adversarial) fake provider below keeps requesting it.
const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({ value: z.string() }).strict(),
  handler: async (args: { value: string }) => ({ echoed: args.value }),
};

test("MAX_TOOL_ROUNDS is the absolute cap on provider.streamTurn() calls, even against an always-tool-requesting provider", async (t) => {
  // Deliberately adversarial: this fake ALWAYS tries to request a tool and
  // report stop_reason "tool_use", on every round, regardless of whether
  // tools were actually offered - proving the loop's own round-count
  // guard terminates it, not good behavior from the "model".
  const { provider, calls } = makeScriptedProvider(() => [
    { type: "tool_use", id: "call-x", name: "echoTool", input: { value: "hi" } },
    { type: "stop", reason: "tool_use" },
  ]);

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.equal(calls.length, AI_LIMITS.MAX_TOOL_ROUNDS, "streamTurn must be called exactly MAX_TOOL_ROUNDS times, never more");

  const lastCall = calls[calls.length - 1];
  assert.equal(lastCall.params.tools.length, 0, "the final permitted round must have tools disabled");

  const doneEvents = events.filter((e) => e.type === "done");
  assert.equal(doneEvents.length, 1, "the loop must still terminate with exactly one done event");
});
