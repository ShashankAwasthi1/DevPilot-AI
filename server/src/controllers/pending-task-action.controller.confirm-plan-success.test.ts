import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeRequest(options: {
  projectId: string;
  conversationId: string;
  actionId: string;
  userId: string;
}): Request {
  return {
    params: { projectId: options.projectId, conversationId: options.conversationId, actionId: options.actionId },
    user: { id: options.userId },
  } as unknown as Request;
}

// Phase 25 Step 3: confirmPendingTaskAction now resolves to either a single
// TaskDto (CREATE_TASK/UPDATE_TASK - covered by
// pending-task-action.controller.confirm-success.test.ts, unchanged) or an
// array of them (CREATE_PROJECT_PLAN). This test proves the controller
// discriminates correctly and uses the plural `{ tasks }` response shape
// for the array case, never conflating it with the singular `{ task }`
// shape.
test("confirmPendingTaskAction: when the service resolves an array (a confirmed project plan), returns 200 with data.tasks - not data.task", async (t) => {
  let recordedArgs: unknown[] = [];
  const createdTasks = [
    { id: "task-1", title: "Set up hosting" },
    { id: "task-2", title: "Write onboarding emails" },
  ];

  t.mock.module("../services/pending-task-action.service", {
    namedExports: {
      confirmPendingTaskAction: async (...args: unknown[]) => {
        recordedArgs = args;
        return createdTasks;
      },
    },
  });

  const { confirmPendingTaskAction } = await import("./pending-task-action.controller");

  const req = makeFakeRequest({
    projectId: "project-1",
    conversationId: "conversation-1",
    actionId: "action-1",
    userId: "user-1",
  });
  const { res, state } = makeFakeJsonResponse();

  await confirmPendingTaskAction(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["action-1", "project-1", "conversation-1", "user-1"]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: { tasks: createdTasks } });
  assert.equal((state.body as { data: Record<string, unknown> }).data.task, undefined);
});
