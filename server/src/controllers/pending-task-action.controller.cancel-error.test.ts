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

test("cancelPendingTaskAction: forwards a service failure (e.g. 409 for an already-confirmed action) to next(err) rather than swallowing it", async (t) => {
  class FakeAppError extends Error {
    statusCode = 409;
  }

  t.mock.module("../services/pending-task-action.service", {
    namedExports: {
      cancelPendingTaskAction: async () => {
        throw new FakeAppError("This proposal is no longer pending");
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
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await cancelPendingTaskAction(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 409);
});
