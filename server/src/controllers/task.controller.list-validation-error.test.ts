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

// No service mock at all here - an out-of-range limit must be rejected by
// listTasksQuerySchema before the service is ever reached, so the real
// (unmocked) service module can safely be imported.
test("listTasks: rejects an out-of-range limit before ever calling the service", async () => {
  const { listTasks } = await import("./task.controller");

  const req = makeFakeListRequest({ projectId: "project-1", userId: "user-1", query: { limit: "500" } });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await listTasks(req, res, next);

  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { statusCode: number }).statusCode, 400);
});
