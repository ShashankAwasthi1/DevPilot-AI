import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeGetRequest(options: { taskId: string; userId: string }): Request {
  return {
    params: { id: options.taskId },
    user: { id: options.userId },
  } as unknown as Request;
}

test("getTask: calls the service with the authenticated userId and the route task id, and returns 200 with the full task", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/task.service", {
    namedExports: {
      getTask: async (...args: unknown[]) => {
        recordedArgs = args;
        return { id: args[1], title: "Ship it", status: "TODO", priority: "MEDIUM" };
      },
    },
  });

  const { getTask } = await import("./task.controller");

  const req = makeFakeGetRequest({ taskId: "task-1", userId: "user-1" });
  const { res, state } = makeFakeJsonResponse();

  await getTask(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "task-1"]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { task: { id: "task-1", title: "Ship it", status: "TODO", priority: "MEDIUM" } },
  });
});
