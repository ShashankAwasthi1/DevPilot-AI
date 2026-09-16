import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// One scenario per file - see agent-runner.pending-action-success.test.ts
// for why (module-cache constraint on agent-runner.ts's own transitive
// "./tool-loop"/"./tools" imports).
const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ id: "t1", title: "Existing task" }],
};

test("runAgentTurn: a successful non-createTask tool call does not yield a pending_action event", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Here are your tasks." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [getTasksTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "What are my tasks?" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "getTasks" && e.ok === true));
  assert.ok(events.some((e) => e.type === "done"));
});
