import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeUpdateRequest(options: { taskId: string; userId: string; body: Record<string, unknown> }): Request {
  return {
    params: { id: options.taskId },
    body: options.body,
    user: { id: options.userId },
  } as unknown as Request;
}

test("updateTask: calls the service with the authenticated userId, the route task id, and the validated body, and returns 200", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/task.service", {
    namedExports: {
      updateTask: async (...args: unknown[]) => {
        recordedArgs = args;
        return { id: args[1], status: (args[2] as { status?: string }).status };
      },
    },
  });

  const { updateTask } = await import("./task.controller");

  const req = makeFakeUpdateRequest({ taskId: "task-1", userId: "user-1", body: { status: "DONE" } });
  const { res, state } = makeFakeJsonResponse();

  await updateTask(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "task-1", { status: "DONE" }]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: { task: { id: "task-1", status: "DONE" } } });
});
