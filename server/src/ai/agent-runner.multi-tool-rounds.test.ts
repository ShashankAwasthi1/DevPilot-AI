import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const getProjectTool = {
  name: "getProject",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => ({ name: "Demo Project" }),
};

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

test("runAgentTurn: chains two different tools across two rounds before producing a final answer", async (t) => {
  const { provider, calls } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [{ type: "tool_use", id: "c1", name: "getProject", input: {} }, { type: "stop", reason: "tool_use" }];
    }
    if (callIndex === 1) {
      return [{ type: "tool_use", id: "c2", name: "getTasks", input: {} }, { type: "stop", reason: "tool_use" }];
    }
    return [{ type: "text", text: "Summary." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [getProjectTool, getTasksTool] } });

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

  const toolCallNames = events
    .filter((e): e is { type: "tool_call"; name: string; input: unknown } => e.type === "tool_call")
    .map((e) => e.name);
  assert.deepEqual(toolCallNames, ["getProject", "getTasks"]);
  assert.deepEqual(events[events.length - 1], { type: "done", text: "Summary." });
  assert.equal(calls.length, 3);
});
