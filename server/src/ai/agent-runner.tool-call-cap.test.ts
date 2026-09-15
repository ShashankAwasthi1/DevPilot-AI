import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AGENT_LIMITS } from "./limits";
import { makeScriptedProvider } from "./fixtures";

let executedCount = 0;

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({ n: z.number() }).strict(),
  handler: async (args: { n: number }) => {
    executedCount++;
    return { n: args.n };
  },
};

function toolUseBlocks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    type: "tool_use" as const,
    id: `call-${i}`,
    name: "echoTool",
    input: { n: i },
  }));
}

test("runAgentTurn: MAX_AGENT_TOOL_CALLS_TOTAL is an absolute cap on executed tool handlers, and every tool_use still gets a tool_result", async (t) => {
  // One round requests more tool_use blocks than the cap allows.
  const requested = AGENT_LIMITS.MAX_AGENT_TOOL_CALLS_TOTAL + 4;

  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [...toolUseBlocks(requested), { type: "stop", reason: "tool_use" }];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

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

  assert.equal(
    executedCount,
    AGENT_LIMITS.MAX_AGENT_TOOL_CALLS_TOTAL,
    "the tool handler must never execute more than MAX_AGENT_TOOL_CALLS_TOTAL times",
  );

  const toolCallEvents = events.filter((e) => e.type === "tool_call");
  const toolResultEvents = events.filter((e) => e.type === "tool_result");
  assert.equal(toolCallEvents.length, requested, "every requested tool_use must still be reported as a tool_call event");
  assert.equal(toolResultEvents.length, requested, "every tool_use must still receive a matching tool_result event");

  const failedResults = toolResultEvents.filter((e) => e.type === "tool_result" && !e.ok);
  assert.equal(failedResults.length, requested - AGENT_LIMITS.MAX_AGENT_TOOL_CALLS_TOTAL);
});
