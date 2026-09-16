import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// One scenario per file - see agent-runner.pending-action-success.test.ts
// for why (module-cache constraint on agent-runner.ts's own transitive
// "./tool-loop"/"./tools" imports).
const failingCreateTaskTool = {
  name: "createTask",
  description: "test",
  schema: z.object({ title: z.string() }).strict(),
  handler: async () => {
    throw new Error("assignee is not a project member");
  },
};

test("runAgentTurn: a failed createTask execution does not yield a pending_action event", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "createTask", input: { title: "Add dark mode support" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Sorry, that didn't work." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [failingCreateTaskTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "Create a task to add dark mode" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "createTask" && e.ok === false));
  assert.ok(events.some((e) => e.type === "done"));
});
