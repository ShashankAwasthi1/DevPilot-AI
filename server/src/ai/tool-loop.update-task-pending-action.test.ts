import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const PENDING_ACTION_REF = {
  actionType: "UPDATE_TASK",
  actionId: "action-1",
  taskId: "task-1",
  taskTitle: "Fix login redirect",
  expiresAt: "2026-01-01T00:15:00.000Z",
  changes: [{ field: "status", from: "IN_PROGRESS", to: "DONE" }],
};

const updateTaskTool = {
  name: "updateTask",
  description: "test",
  schema: z.object({ taskId: z.string(), status: z.string().optional() }).strict(),
  handler: async () => ({
    result: { status: "pending_confirmation", actionId: "action-1", summary: "Proposed an update." },
    pendingAction: PENDING_ACTION_REF,
  }),
};

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

// Mirrors tool-loop.create-task-pending-action.test.ts's structure exactly
// - chat mode's bridging is identical between createTask and updateTask,
// both going through the same shared extractPendingAction/executeToolCall
// recognition (by tool name), never a parallel mechanism.
test("runChatTurn: updateTask's model-facing tool_result never contains pendingAction fields, which instead appear only in a dedicated pending_action event; other tools are unaffected", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "updateTask", input: { taskId: "task-1", status: "DONE" } },
        { type: "tool_use", id: "c2", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [updateTaskTool, getTasksTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1", conversationId: "c1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.equal(events.filter((e) => e.type === "source").length, 0);

  const pendingActionEvents = events.filter((e) => e.type === "pending_action");
  assert.equal(pendingActionEvents.length, 1, "exactly one pending_action event for the one updateTask call");
  assert.deepEqual(pendingActionEvents[0], { type: "pending_action", pendingAction: PENDING_ACTION_REF });

  // Ordering: tool_result -> pending_action, same as createTask's own
  // yield order.
  const toolResultIndex = events.findIndex((e) => e.type === "tool_result" && e.name === "updateTask");
  const pendingActionIndex = events.findIndex((e) => e.type === "pending_action");
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);

  const updateTaskResult = events.find((e) => e.type === "tool_result" && e.name === "updateTask");
  assert.deepEqual(updateTaskResult, { type: "tool_result", name: "updateTask", ok: true });

  // The model-facing tool_result content is still exactly the minimal ack
  // - the richer pendingAction fields (changes, taskTitle, etc.) never
  // appear anywhere in a tool_call/tool_result event, only in the
  // dedicated pending_action event asserted above. This also proves the
  // stream never implies the task was already mutated - only that a
  // proposal is pending.
  const toolCallAndResultEvents = events.filter((e) => e.type === "tool_call" || e.type === "tool_result");
  const serialized = JSON.stringify(toolCallAndResultEvents);
  assert.ok(!serialized.includes("taskTitle"));
  assert.ok(!serialized.includes("changes"));
  assert.ok(!serialized.includes("updated successfully"));
});
