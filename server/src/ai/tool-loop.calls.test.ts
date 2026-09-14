import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AI_LIMITS } from "./limits";
import { makeScriptedProvider } from "./fixtures";
import type { ProviderContentBlock } from "./provider";

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

function toolUseBlocks(count: number, roundOffset: number) {
  return Array.from({ length: count }, (_, i) => ({
    type: "tool_use" as const,
    id: `call-${roundOffset}-${i}`,
    name: "echoTool",
    input: { n: roundOffset * 10 + i },
  }));
}

test("MAX_TOOL_CALLS_TOTAL is an absolute cap on executed tool handlers, and every tool_use still gets a tool_result", async (t) => {
  // Round 1 requests 4 tool_use blocks in a single response (parallel tool
  // calls), round 2 requests 4 more - 8 total requested, well past the
  // configured cap of 6. Round 3+ gives up and answers with text.
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [...toolUseBlocks(4, 1), { type: "stop", reason: "tool_use" }];
    }
    if (callIndex === 1) {
      return [...toolUseBlocks(4, 2), { type: "stop", reason: "tool_use" }];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

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

  assert.equal(
    executedCount,
    AI_LIMITS.MAX_TOOL_CALLS_TOTAL,
    "the tool handler must never execute more than MAX_TOOL_CALLS_TOTAL times",
  );

  const toolCallEvents = events.filter((e) => e.type === "tool_call");
  const toolResultEvents = events.filter((e) => e.type === "tool_result");
  assert.equal(toolCallEvents.length, 8, "all 8 requested tool_use blocks must be reported as tool_call events");
  assert.equal(
    toolResultEvents.length,
    8,
    "every tool_use block must receive a matching tool_result event, even ones beyond the cap",
  );

  const failedResults = toolResultEvents.filter((e) => e.type === "tool_result" && !e.ok);
  assert.equal(failedResults.length, 2, "exactly the 2 calls beyond the cap must be reported as failed");

  // Protocol fidelity: by the time round i+1 is sent, the messages array
  // must already contain round i's assistant tool_use blocks immediately
  // followed by a matching count of tool_result blocks in the next user
  // message - Anthropic requires every tool_use to be answered before the
  // next model call.
  for (let i = 0; i < calls.length - 1; i++) {
    const sentMessages = calls[i + 1].params.messages;
    const lastAssistant = [...sentMessages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant || typeof lastAssistant.content === "string") continue;
    const requestedCount = (lastAssistant.content as ProviderContentBlock[]).filter(
      (b) => b.type === "tool_use",
    ).length;
    if (requestedCount === 0) continue;

    const lastUser = [...sentMessages].reverse().find((m) => m.role === "user");
    const resultCount =
      lastUser && typeof lastUser.content !== "string"
        ? (lastUser.content as ProviderContentBlock[]).filter((b) => b.type === "tool_result").length
        : 0;
    assert.equal(resultCount, requestedCount, `round ${i} requested ${requestedCount} tool_use but got ${resultCount} tool_result`);
  }
});
