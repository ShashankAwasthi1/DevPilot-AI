import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({ value: z.string() }).strict(),
  handler: async (args: { value: string }) => ({ echoed: args.value }),
};

test("runAgentTurn: one tool round followed by a final text answer", async (t) => {
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "call-1", name: "echoTool", input: { value: "x" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Done." }, { type: "stop", reason: "end_turn" }];
  });

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
    { type: "tool_call", name: "echoTool", input: { value: "x" } },
    { type: "tool_result", name: "echoTool", ok: true },
    { type: "text", text: "Done." },
    { type: "done", text: "Done." },
  ]);

  assert.equal(calls.length, 2);
  assert.ok(calls[0].params.tools.length > 0, "the first round must offer tools");
});
