import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// One scenario per file for agent-runner tests (see
// agent-runner.tool-errors.test.ts, agent-runner.multi-tool-rounds.test.ts,
// etc.) - agent-runner.ts's own static `import ... from "./tool-loop"`
// resolves to whatever "./tool-loop" (and, transitively, "./tools"/
// "./index") module instance is already cached for that exact
// (unversioned) specifier, regardless of how many query-string variants of
// "./agent-runner" itself get freshly imported - so a single test file
// cannot give two tests two different TOOLS/getAIProvider mocks. Splitting
// one scenario per file sidesteps the issue entirely, matching this
// suite's existing convention.
const PENDING_ACTION_REF = {
  actionId: "action-1",
  title: "Add dark mode support",
  description: "Some detail",
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: "user-2",
  assigneeName: "Mira Member",
  dueDate: "2026-03-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:15:00.000Z",
};

const createTaskTool = {
  name: "createTask",
  description: "test",
  schema: z.object({ title: z.string() }).strict(),
  handler: async () => ({
    result: { status: "pending_confirmation", actionId: PENDING_ACTION_REF.actionId, summary: "..." },
    pendingAction: PENDING_ACTION_REF,
  }),
};

test("runAgentTurn: a successful createTask execution yields a pending_action event with the exact payload, after tool_result", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "createTask", input: { title: "Add dark mode support" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Done." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [createTaskTool] } });

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

  const pendingActionEvents = events.filter((e) => e.type === "pending_action");
  assert.equal(pendingActionEvents.length, 1);
  assert.deepEqual(pendingActionEvents[0], { type: "pending_action", pendingAction: PENDING_ACTION_REF });

  // Ordering: tool_result -> pending_action, matching runChatTurn's own
  // yield order.
  const toolResultIndex = events.findIndex((e) => e.type === "tool_result");
  const pendingActionIndex = events.findIndex((e) => e.type === "pending_action");
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);

  // Existing tool_result/done behavior remains intact alongside the new
  // event.
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "createTask" && e.ok === true));
  assert.ok(events.some((e) => e.type === "done"));

  // Never exposes projectId/userId/conversationId - only the presentation
  // fields extractPendingAction already validated.
  assert.deepEqual(Object.keys(pendingActionEvents[0].pendingAction).sort(), [
    "actionId",
    "assigneeId",
    "assigneeName",
    "description",
    "dueDate",
    "expiresAt",
    "priority",
    "status",
    "title",
  ]);
});
