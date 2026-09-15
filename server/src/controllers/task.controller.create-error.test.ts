import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { capturingNext, makeFakeJsonResponse } from "./test-helpers";

function makeFakeCreateRequest(options: { projectId: string; userId: string; body: Record<string, unknown> }): Request {
  return {
    params: { projectId: options.projectId },
    body: options.body,
    user: { id: options.userId },
  } as unknown as Request;
}

test("createTask: forwards a service failure to next(err) rather than swallowing or converting it", async (t) => {
  class FakeAppError extends Error {
    statusCode = 403;
  }

  t.mock.module("../services/task.service", {
    namedExports: {
      createTask: async () => {
        throw new FakeAppError("You do not have permission to perform this action");
      },
    },
  });

  const { createTask } = await import("./task.controller");

  const req = makeFakeCreateRequest({
    projectId: "project-1",
    userId: "user-1",
    body: { title: "Ship it", status: "TODO", priority: "MEDIUM" },
  });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await createTask(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 403);
});
