import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

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

let recordedArgs: unknown[] = [];

test("listTasks: calls listTaskSummariesForProject with the authenticated userId + route projectId, and applies the default bounded limit", async (t) => {
  t.mock.module("../services/task.service", {
    namedExports: {
      listTaskSummariesForProject: async (...args: unknown[]) => {
        recordedArgs = args;
        return [{ id: "task-1", title: "Task", status: "TODO", priority: "MEDIUM", assigneeName: null }];
      },
    },
  });

  const { listTasks } = await import("./task.controller");

  const req = makeFakeListRequest({ projectId: "project-1", userId: "user-1", query: {} });
  const { res, state } = makeFakeJsonResponse();

  await listTasks(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "project-1", 20]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { tasks: [{ id: "task-1", title: "Task", status: "TODO", priority: "MEDIUM", assigneeName: null }] },
  });
});

test("listTasks: passes an explicit, in-range limit query param through to the service", async () => {
  // No second t.mock.module call needed - the mock installed above stays
  // in effect for the rest of this file (see task.service.create.test.ts
  // for the same one-mock-per-file convention).
  const { listTasks } = await import("./task.controller");

  const req = makeFakeListRequest({ projectId: "project-1", userId: "user-1", query: { limit: "5" } });
  const { res } = makeFakeJsonResponse();

  await listTasks(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "project-1", 5]);
});
