import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";
import type { ProviderContentBlock } from "./provider";

const echoTool = {
  name: "echoTool",
  description: "test tool - expects { value: string }",
  schema: z.object({ value: z.string() }).strict(),
  handler: async (args: { value: string }) => ({ echoed: args.value }),
};

const boomTool = {
  name: "boomTool",
  description: "test tool that always fails, simulating an authorization or execution failure",
  schema: z.object({}).strict(),
  handler: async () => {
    throw new Error("simulated internal failure - this text must never reach the model");
  },
};

test("unknown tool, malformed arguments, and tool execution failure are all handled without crashing the turn", async (t) => {
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "call-unknown", name: "doesNotExist", input: {} },
        { type: "tool_use", id: "call-malformed", name: "echoTool", input: { value: 123 } }, // wrong type
        { type: "tool_use", id: "call-boom", name: "boomTool", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "I could not complete those lookups." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool, boomTool] } });

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

  const results = events.filter((e) => e.type === "tool_result");
  assert.equal(results.length, 3, "all three tool_use blocks must receive a tool_result");
  assert.ok(
    results.every((r) => r.type === "tool_result" && r.ok === false),
    "unknown tool, malformed args, and execution failure must all report ok:false",
  );

  const done = events.find((e) => e.type === "done");
  assert.ok(done, "the loop must recover and still reach a final done event, not crash");

  // The internal error text from boomTool's handler must never reach the
  // model - only the generic, safe message should appear in what's sent
  // back as tool_result content.
  const sentToModel = JSON.stringify(calls[1].params.messages);
  assert.ok(
    !sentToModel.includes("simulated internal failure"),
    "the tool handler's internal error text must never be sent to the model",
  );
  const lastUser = [...calls[1].params.messages].reverse().find((m) => m.role === "user");
  assert.ok(lastUser && typeof lastUser.content !== "string");
  const toolResultBlocks = (lastUser!.content as ProviderContentBlock[]).filter((b) => b.type === "tool_result");
  assert.equal(toolResultBlocks.length, 3);
  assert.ok(toolResultBlocks.every((b) => b.type === "tool_result" && b.isError === true));
});
