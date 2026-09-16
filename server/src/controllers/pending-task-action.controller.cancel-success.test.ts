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

test("cancelPendingTaskAction: calls the service with actionId/projectId/conversationId (route params) and the authenticated userId, with no body dependency, and returns 200 with the cancelled action", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/pending-task-action.service", {
    namedExports: {
      cancelPendingTaskAction: async (...args: unknown[]) => {
        recordedArgs = args;
        return { actionId: "action-1", status: "CANCELLED" };
      },
    },
  });

  const { cancelPendingTaskAction } = await import("./pending-task-action.controller");

  const req = makeFakeRequest({
    projectId: "project-1",
    conversationId: "conversation-1",
    actionId: "action-1",
    userId: "user-1",
  });
  const { res, state } = makeFakeJsonResponse();

  await cancelPendingTaskAction(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["action-1", "project-1", "conversation-1", "user-1"]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { action: { actionId: "action-1", status: "CANCELLED" } },
  });
});
