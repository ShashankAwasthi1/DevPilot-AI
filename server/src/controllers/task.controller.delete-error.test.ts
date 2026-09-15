import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { capturingNext, makeFakeJsonResponse } from "./test-helpers";

function makeFakeDeleteRequest(options: { taskId: string; userId: string }): Request {
  return {
    params: { id: options.taskId },
    body: {},
    user: { id: options.userId },
  } as unknown as Request;
}

test("deleteTask: forwards a service failure (e.g. the existing 404 for a nonexistent/foreign task) to next(err)", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/task.service", {
    namedExports: {
      deleteTask: async () => {
        throw new FakeAppError("Task not found");
      },
    },
  });

  const { deleteTask } = await import("./task.controller");

  const req = makeFakeDeleteRequest({ taskId: "does-not-exist", userId: "user-1" });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await deleteTask(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
