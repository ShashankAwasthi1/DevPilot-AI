import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { capturingNext, makeFakeJsonResponse } from "./test-helpers";

function makeFakeListRequest(options: {
  projectId: string;
  userId: string;
  query: Record<string, unknown>;
}): Request {
  return {
    params: { projectId: options.projectId },
    query: options.query,
    user: { id: options.userId },
  } as unknown as Request;
}

test("listTasks: forwards a service failure (e.g. the existing 404 for a nonexistent/foreign project) to next(err)", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/task.service", {
    namedExports: {
      listTaskSummariesForProject: async () => {
        throw new FakeAppError("Project not found");
      },
    },
  });

  const { listTasks } = await import("./task.controller");

  const req = makeFakeListRequest({ projectId: "does-not-exist", userId: "user-1", query: {} });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await listTasks(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
