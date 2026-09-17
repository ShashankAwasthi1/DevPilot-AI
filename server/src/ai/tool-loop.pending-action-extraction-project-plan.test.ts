import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPendingAction, type ToolExecutionResult } from "./tool-loop";
import type { ProjectPlanPendingActionRef } from "./tools/generate-project-plan.tool";
import type { ToolDefinition } from "./tools/types";

// Plain unit tests for extractPendingAction's CREATE_PROJECT_PLAN branch -
// no module mocking needed since it's a pure function of its two
// arguments. Mirrors tool-loop.pending-action-extraction.test.ts's
// UPDATE_TASK section exactly, in a separate file so the pre-existing
// extraction test file (already reviewed/approved) stays untouched.

const generateProjectPlanTool: ToolDefinition<any> = {
  name: "generateProjectPlan",
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

const VALID_PROJECT_PLAN_PENDING_ACTION: ProjectPlanPendingActionRef = {
  actionType: "CREATE_PROJECT_PLAN",
  actionId: "action-1",
  planTitle: "MVP Launch Plan",
  summary: "Get the SaaS MVP launched.",
  tasks: [
    { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
    { tempId: "t2", title: "Write onboarding emails", description: "Draft the welcome series", priority: "HIGH" },
  ],
  expiresAt: "2026-01-01T00:15:00.000Z",
};

test("extractPendingAction: returns the pendingAction for a successful generateProjectPlan execution", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation" },
    pendingAction: VALID_PROJECT_PLAN_PENDING_ACTION,
  };

  assert.deepEqual(extractPendingAction(generateProjectPlanTool, executionResult), VALID_PROJECT_PLAN_PENDING_ACTION);
});

test("extractPendingAction: returns null for a tool other than createTask/updateTask/generateProjectPlan", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_PROJECT_PLAN_PENDING_ACTION,
  };

  assert.equal(extractPendingAction(otherTool, executionResult), null);
});

test("extractPendingAction: returns null for a failed generateProjectPlan execution", () => {
  const executionResult: ToolExecutionResult = { ok: false };
  assert.equal(extractPendingAction(generateProjectPlanTool, executionResult), null);
});

test("extractPendingAction: returns null when a successful generateProjectPlan result carries no pendingAction at all", () => {
  const executionResult: ToolExecutionResult = { ok: true, result: {} };
  assert.equal(extractPendingAction(generateProjectPlanTool, executionResult), null);
});

test("extractPendingAction: defensively returns null for a malformed generateProjectPlan pendingAction (missing/empty actionId, planTitle, expiresAt, or a non-array tasks)", () => {
  const base = VALID_PROJECT_PLAN_PENDING_ACTION;

  for (const bad of [
    { ...base, actionId: "" },
    { ...base, actionId: undefined },
    { ...base, planTitle: "" },
    { ...base, planTitle: undefined },
    { ...base, expiresAt: "" },
    { ...base, expiresAt: undefined },
    { ...base, tasks: "not-an-array" },
  ]) {
    const executionResult = { ok: true, result: {}, pendingAction: bad } as unknown as ToolExecutionResult;
    assert.equal(extractPendingAction(generateProjectPlanTool, executionResult), null, JSON.stringify(bad));
  }
});

test("extractPendingAction: a generateProjectPlan proposal with zero valid tasks is rejected as malformed", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: { ...VALID_PROJECT_PLAN_PENDING_ACTION, tasks: [] },
  };

  assert.equal(extractPendingAction(generateProjectPlanTool, executionResult), null);
});

test("extractPendingAction: individually malformed task entries are filtered out, valid ones survive", () => {
  const executionResult = {
    ok: true,
    result: {},
    pendingAction: {
      ...VALID_PROJECT_PLAN_PENDING_ACTION,
      tasks: [
        { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
        { tempId: "", title: "Missing tempId", description: null, priority: "MEDIUM" },
        { tempId: "t3", title: "", description: null, priority: "MEDIUM" },
        { tempId: "t4", title: "Missing priority", description: null, priority: 123 },
        { tempId: "t5", title: "Valid with description", description: "Do the thing", priority: "LOW" },
      ],
    },
  } as unknown as ToolExecutionResult;

  const pendingAction = extractPendingAction(generateProjectPlanTool, executionResult);
  if (pendingAction?.actionType !== "CREATE_PROJECT_PLAN") {
    assert.fail("expected a CREATE_PROJECT_PLAN pendingAction");
  }
  assert.deepEqual(pendingAction.tasks, [
    { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
    { tempId: "t5", title: "Valid with description", description: "Do the thing", priority: "LOW" },
  ]);
});

test("extractPendingAction: a missing/omitted summary normalizes to null", () => {
  const { summary, ...rest } = VALID_PROJECT_PLAN_PENDING_ACTION;
  void summary;
  const executionResult = {
    ok: true,
    result: {},
    pendingAction: rest,
  } as unknown as ToolExecutionResult;

  const pendingAction = extractPendingAction(generateProjectPlanTool, executionResult);
  if (pendingAction?.actionType !== "CREATE_PROJECT_PLAN") {
    assert.fail("expected a CREATE_PROJECT_PLAN pendingAction");
  }
  assert.equal(pendingAction.summary, null);
});

test("extractPendingAction: a generateProjectPlan result contains only the expected presentation fields, never internal proposal data", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: {},
    pendingAction: VALID_PROJECT_PLAN_PENDING_ACTION,
  };

  const pendingAction = extractPendingAction(generateProjectPlanTool, executionResult);
  assert.deepEqual(
    Object.keys(pendingAction!).sort(),
    ["actionType", "actionId", "planTitle", "summary", "tasks", "expiresAt"].sort(),
  );
  const serialized = JSON.stringify(pendingAction);
  assert.ok(!serialized.includes("projectId"));
  assert.ok(!serialized.includes("userId"));
  assert.ok(!serialized.includes("conversationId"));
});

test("extractPendingAction: does not imply any task was already created - the model-facing result is untouched by this helper", () => {
  const executionResult: ToolExecutionResult = {
    ok: true,
    result: { status: "pending_confirmation", actionId: "action-1", summary: "Proposed a plan with 2 tasks." },
    pendingAction: VALID_PROJECT_PLAN_PENDING_ACTION,
  };

  extractPendingAction(generateProjectPlanTool, executionResult);
  assert.equal(executionResult.ok, true);
  assert.equal((executionResult as { result: { status: string } }).result.status, "pending_confirmation");
});
