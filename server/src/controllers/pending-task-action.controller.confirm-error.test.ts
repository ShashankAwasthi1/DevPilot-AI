import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { capturingNext, makeFakeJsonResponse } from "./test-helpers";

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

test("confirmPendingTaskAction: forwards a service failure (e.g. 404 for a mismatched/unknown action) to next(err) rather than creating anything", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/pending-task-action.service", {
    namedExports: {
      confirmPendingTaskAction: async () => {
        throw new FakeAppError("Pending action not found");
      },
    },
  });

  const { confirmPendingTaskAction } = await import("./pending-task-action.controller");

  const req = makeFakeRequest({
    projectId: "project-1",
    conversationId: "conversation-1",
    actionId: "not-a-real-action",
    userId: "user-1",
  });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await confirmPendingTaskAction(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
