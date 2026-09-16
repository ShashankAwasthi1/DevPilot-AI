import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// One scenario per file for agent-runner tests (see
// agent-runner.pending-action-success.test.ts for why).
const PENDING_ACTION_REF = {
  actionType: "UPDATE_TASK",
  actionId: "action-1",
  taskId: "task-1",
  taskTitle: "Fix login redirect",
  expiresAt: "2026-01-01T00:15:00.000Z",
  changes: [
    { field: "status", from: "IN_PROGRESS", to: "DONE" },
    { field: "assigneeId", from: "user-1", to: "user-2" },
  ],
};

const updateTaskTool = {
  name: "updateTask",
  description: "test",
  schema: z.object({ taskId: z.string() }).strict(),
  handler: async () => ({
    result: { status: "pending_confirmation", actionId: PENDING_ACTION_REF.actionId, summary: "..." },
    pendingAction: PENDING_ACTION_REF,
  }),
};

test("runAgentTurn: a successful updateTask execution yields a pending_action event with the exact payload, after tool_result", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "updateTask", input: { taskId: "task-1" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Done." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [updateTaskTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "Mark the login redirect task as done and reassign it" }],
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
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "updateTask" && e.ok === true));
  assert.ok(events.some((e) => e.type === "done"));

  // Never exposes projectId/userId/conversationId or the proposal's
  // snapshot - only the presentation fields extractPendingAction already
  // validated.
  assert.deepEqual(Object.keys(pendingActionEvents[0].pendingAction).sort(), [
    "actionType",
    "actionId",
    "taskId",
    "taskTitle",
    "expiresAt",
    "changes",
  ].sort());
});
