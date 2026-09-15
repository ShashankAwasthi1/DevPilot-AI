import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AGENT_LIMITS } from "./limits";
import { makeScriptedProvider } from "./fixtures";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({ value: z.string() }).strict(),
  handler: async (args: { value: string }) => ({ echoed: args.value }),
};

test("runAgentTurn: MAX_AGENT_ROUNDS is the absolute cap on provider.streamTurn() calls, and the final round is always tool-free", async (t) => {
  // Deliberately adversarial: always requests a tool and reports
  // stop_reason "tool_use", regardless of whether tools were offered -
  // proving the runner's own round-count guard terminates it.
  const { provider, calls } = makeScriptedProvider(() => [
    { type: "tool_use", id: "call-x", name: "echoTool", input: { value: "hi" } },
    { type: "stop", reason: "tool_use" },
  ]);

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

  assert.equal(calls.length, AGENT_LIMITS.MAX_AGENT_ROUNDS, "streamTurn must be called exactly MAX_AGENT_ROUNDS times");
  assert.deepEqual(calls[calls.length - 1].params.tools, [], "the final round must have tools disabled (an empty array, not omitted)");

  const doneEvents = events.filter((e) => e.type === "done");
  assert.equal(doneEvents.length, 1, "the run must still terminate with exactly one done event");
});
