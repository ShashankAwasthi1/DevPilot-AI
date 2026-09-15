import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeCreateRequest(options: { projectId: string; userId: string; body: Record<string, unknown> }): Request {
  return {
    params: { projectId: options.projectId },
    body: options.body,
    user: { id: options.userId },
  } as unknown as Request;
}

test("createTask: calls the service with the authenticated userId, the route projectId, and the validated body, and returns 201", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/task.service", {
    namedExports: {
      createTask: async (...args: unknown[]) => {
        recordedArgs = args;
        return { id: "task-1", projectId: args[1], title: (args[2] as { title: string }).title };
      },
    },
  });

  const { createTask } = await import("./task.controller");

  const req = makeFakeCreateRequest({
    projectId: "project-1",
    userId: "user-1",
    body: { title: "Ship it", status: "TODO", priority: "MEDIUM" },
  });
  const { res, state } = makeFakeJsonResponse();

  await createTask(req, res, throwingNext());

  assert.deepEqual(recordedArgs, [
    "user-1",
    "project-1",
    { title: "Ship it", status: "TODO", priority: "MEDIUM" },
  ]);
  assert.equal(state.statusCode, 201);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { task: { id: "task-1", projectId: "project-1", title: "Ship it" } },
  });
});
