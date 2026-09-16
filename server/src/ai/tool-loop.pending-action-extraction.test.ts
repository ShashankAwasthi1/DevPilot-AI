import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPendingAction, type ToolExecutionResult } from "./tool-loop";
import type { PendingTaskActionRef } from "./tools/create-task.tool";
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

const otherTool: ToolDefinition<any> = {
  name: "getTasks",
  description: "test",
  schema: {} as ToolDefinition<any>["schema"],
  handler: async () => [],
};

const VALID_PENDING_ACTION = {
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

test("extractPendingAction: returns the pendingAction for a successful createTask execution", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation" },
    pendingAction: VALID_PENDING_ACTION,
  };

  assert.deepEqual(extractPendingAction(createTaskTool, executionResult), VALID_PENDING_ACTION);
});

test("extractPendingAction: returns null for any tool other than createTask", () => {
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

test("extractPendingAction: defensively returns null for a malformed pendingAction (missing/empty actionId, title, or expiresAt)", () => {
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
      actionId: "action-1",
      title: "Task",
      status: "TODO",
      priority: "MEDIUM",
      expiresAt: "2026-01-01T00:15:00.000Z",
    } as unknown as PendingTaskActionRef,
  };

  assert.deepEqual(extractPendingAction(createTaskTool, executionResult), {
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

test("extractPendingAction: returned value contains only the expected presentation fields", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_PENDING_ACTION,
  };

  const pendingAction = extractPendingAction(createTaskTool, executionResult);
  assert.deepEqual(
    Object.keys(pendingAction!).sort(),
    ["actionId", "assigneeId", "assigneeName", "description", "dueDate", "expiresAt", "priority", "status", "title"].sort(),
  );
});
