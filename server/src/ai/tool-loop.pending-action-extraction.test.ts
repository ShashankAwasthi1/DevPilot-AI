import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPendingAction, type ToolExecutionResult } from "./tool-loop";
import type { PendingTaskActionRef } from "./tools/create-task.tool";
import type { UpdateTaskPendingActionRef } from "./tools/update-task.tool";
import type { ToolDefinition } from "./tools/types";

// Plain unit tests for the shared extractPendingAction helper - no module
// mocking needed since it's a pure function of its two arguments. Mirrors
// tool-loop.source-extraction.test.ts's structure exactly.

const createTaskTool: ToolDefinition<any> = {
  name: "createTask",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => ({ result: {}, pendingAction: {} }),
};

const updateTaskTool: ToolDefinition<any> = {
  name: "updateTask",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => ({ result: {}, pendingAction: {} }),
};

const otherTool: ToolDefinition<any> = {
  name: "getTasks",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => [],
};

const VALID_PENDING_ACTION: PendingTaskActionRef = {
  actionType: "CREATE_TASK",
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

const VALID_UPDATE_PENDING_ACTION: UpdateTaskPendingActionRef = {
  actionType: "UPDATE_TASK",
  actionId: "action-2",
  taskId: "task-1",
  taskTitle: "Fix login redirect",
  expiresAt: "2026-01-01T00:15:00.000Z",
  changes: [
    { field: "status", from: "IN_PROGRESS", to: "DONE" },
    { field: "assigneeId", from: "user-1", to: "user-2" },
  ],
};

// --- CREATE_TASK -----------------------------------------------------------

test("extractPendingAction: returns the pendingAction for a successful createTask execution", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation" },
    pendingAction: VALID_PENDING_ACTION,
  };

  assert.deepEqual(extractPendingAction(createTaskTool, executionResult), VALID_PENDING_ACTION);
});

test("extractPendingAction: returns null for any tool other than createTask/updateTask", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_PENDING_ACTION,
  };

  assert.equal(extractPendingAction(otherTool, executionResult), null);
});

test("extractPendingAction: returns null for a failed execution", () => {
  const executionResult: ToolExecutionResult = { ok: false };
  assert.equal(extractPendingAction(createTaskTool, executionResult), null);
});

test("extractPendingAction: returns null when the successful result carries no pendingAction at all", () => {
  const executionResult: ToolExecutionResult = { ok: true, result: {} };
  assert.equal(extractPendingAction(createTaskTool, executionResult), null);
});

test("extractPendingAction: defensively returns null for a malformed createTask pendingAction (missing/empty actionId, title, or expiresAt)", () => {
  const base = VALID_PENDING_ACTION;

  for (const bad of [
    { ...base, actionId: "" },
    { ...base, actionId: undefined },
    { ...base, title: "" },
    { ...base, title: undefined },
    { ...base, expiresAt: "" },
    { ...base, expiresAt: undefined },
  ]) {
    const executionResult = { ok: true, result: {}, pendingAction: bad } as unknown as ToolExecutionResult;
    assert.equal(extractPendingAction(createTaskTool, executionResult), null, JSON.stringify(bad));
  }
});

test("extractPendingAction: normalizes missing optional fields (description/assigneeId/assigneeName/dueDate) to null", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: {
      actionType: "CREATE_TASK",
      actionId: "action-1",
      title: "Task",
      status: "TODO",
      priority: "MEDIUM",
      expiresAt: "2026-01-01T00:15:00.000Z",
    } as unknown as PendingTaskActionRef,
  };

  assert.deepEqual(extractPendingAction(createTaskTool, executionResult), {
    actionType: "CREATE_TASK",
    actionId: "action-1",
    title: "Task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    expiresAt: "2026-01-01T00:15:00.000Z",
  });
});

test("extractPendingAction: a createTask result contains only the expected presentation fields", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_PENDING_ACTION,
  };

  const pendingAction = extractPendingAction(createTaskTool, executionResult);
  assert.deepEqual(
    Object.keys(pendingAction!).sort(),
    ["actionType", "actionId", "assigneeId", "assigneeName", "description", "dueDate", "expiresAt", "priority", "status", "title"].sort(),
  );
});

// --- UPDATE_TASK -----------------------------------------------------------

test("extractPendingAction: returns the pendingAction for a successful updateTask execution", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation" },
    pendingAction: VALID_UPDATE_PENDING_ACTION,
  };

  assert.deepEqual(extractPendingAction(updateTaskTool, executionResult), VALID_UPDATE_PENDING_ACTION);
});

test("extractPendingAction: an updateTask result has actionType UPDATE_TASK and includes taskId/expiresAt", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_UPDATE_PENDING_ACTION,
  };

  const pendingAction = extractPendingAction(updateTaskTool, executionResult);
  if (pendingAction?.actionType !== "UPDATE_TASK") {
    assert.fail("expected an UPDATE_TASK pendingAction");
  }
  assert.equal(pendingAction.taskId, "task-1");
  assert.equal(pendingAction.expiresAt, "2026-01-01T00:15:00.000Z");
});

test("extractPendingAction: defensively returns null for a malformed updateTask pendingAction (missing/empty actionId, taskId, taskTitle, or expiresAt)", () => {
  const base = VALID_UPDATE_PENDING_ACTION;

  for (const bad of [
    { ...base, actionId: "" },
    { ...base, actionId: undefined },
    { ...base, taskId: "" },
    { ...base, taskId: undefined },
    { ...base, taskTitle: "" },
    { ...base, taskTitle: undefined },
    { ...base, expiresAt: "" },
    { ...base, expiresAt: undefined },
    { ...base, changes: "not-an-array" },
  ]) {
    const executionResult = { ok: true, result: {}, pendingAction: bad } as unknown as ToolExecutionResult;
    assert.equal(extractPendingAction(updateTaskTool, executionResult), null, JSON.stringify(bad));
  }
});

test("extractPendingAction: an updateTask proposal with zero valid changes is rejected as malformed", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: { ...VALID_UPDATE_PENDING_ACTION, changes: [] },
  };

  assert.equal(extractPendingAction(updateTaskTool, executionResult), null);
});

test("extractPendingAction: individually malformed change entries are filtered out, valid ones survive", () => {
  const executionResult = {
    ok: true,
    result: {},
    pendingAction: {
      ...VALID_UPDATE_PENDING_ACTION,
      changes: [
        { field: "status", from: "IN_PROGRESS", to: "DONE" },
        { field: "not-a-real-field", from: "x", to: "y" },
        { field: "priority", from: 123, to: "HIGH" },
        { field: "title", from: "Old", to: null },
      ],
    },
  } as unknown as ToolExecutionResult;

  const pendingAction = extractPendingAction(updateTaskTool, executionResult);
  if (pendingAction?.actionType !== "UPDATE_TASK") {
    assert.fail("expected an UPDATE_TASK pendingAction");
  }
  assert.deepEqual(pendingAction.changes, [
    { field: "status", from: "IN_PROGRESS", to: "DONE" },
    { field: "title", from: "Old", to: null },
  ]);
});

test("extractPendingAction: explicit null from/to values are preserved for an updateTask change", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: {
      ...VALID_UPDATE_PENDING_ACTION,
      changes: [{ field: "assigneeId", from: "user-1", to: null }],
    },
  };

  const pendingAction = extractPendingAction(updateTaskTool, executionResult);
  if (pendingAction?.actionType !== "UPDATE_TASK") {
    assert.fail("expected an UPDATE_TASK pendingAction");
  }
  assert.deepEqual(pendingAction.changes, [{ field: "assigneeId", from: "user-1", to: null }]);
});

test("extractPendingAction: an updateTask result contains only the expected presentation fields, never internal proposal data", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_UPDATE_PENDING_ACTION,
  };

  const pendingAction = extractPendingAction(updateTaskTool, executionResult);
  assert.deepEqual(
    Object.keys(pendingAction!).sort(),
    ["actionType", "actionId", "taskId", "taskTitle", "expiresAt", "changes"].sort(),
  );
  // No snapshot, no full proposedInput, no projectId/userId/conversationId
  // anywhere in the extracted value.
  const serialized = JSON.stringify(pendingAction);
  assert.ok(!serialized.includes("snapshot"));
  assert.ok(!serialized.includes("projectId"));
  assert.ok(!serialized.includes("userId"));
});

test("extractPendingAction: does not imply the task was already updated - the model-facing result is untouched by this helper", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation", actionId: "action-2", summary: "Proposed an update — awaiting confirmation." },
    pendingAction: VALID_UPDATE_PENDING_ACTION,
  };

  extractPendingAction(updateTaskTool, executionResult);
  assert.equal(executionResult.ok, true);
  assert.equal((executionResult as { result: { status: string } }).result.status, "pending_confirmation");
});
