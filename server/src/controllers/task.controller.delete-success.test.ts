import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeDeleteRequest(options: { taskId: string; userId: string }): Request {
  return {
    params: { id: options.taskId },
    body: {},
    user: { id: options.userId },
  } as unknown as Request;
}

test("deleteTask: calls the service with the authenticated userId and the route task id, and returns 200 with an empty data object", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/task.service", {
    namedExports: {
      deleteTask: async (...args: unknown[]) => {
        recordedArgs = args;
      },
    },
  });

  const { deleteTask } = await import("./task.controller");

  const req = makeFakeDeleteRequest({ taskId: "task-1", userId: "user-1" });
  const { res, state } = makeFakeJsonResponse();

  await deleteTask(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "task-1"]);
  // Exactly HTTP 200 with { status: "ok", data: {} } - never 204, since
  // the client's request() helper always attempts to parse a JSON body.
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: {} });
});
