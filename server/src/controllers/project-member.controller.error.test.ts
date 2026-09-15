import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { capturingNext, makeFakeJsonResponse } from "./test-helpers";

function makeFakeRequest(options: { projectId: string; userId: string }): Request {
  return {
    params: { id: options.projectId },
    user: { id: options.userId },
  } as unknown as Request;
}

test("listProjectMembers: forwards a service failure (e.g. the existing 404 for a nonexistent/inaccessible project) to next(err) rather than leaking member data", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/project-member.service", {
    namedExports: {
      listProjectMembers: async () => {
        throw new FakeAppError("Project not found");
      },
    },
  });

  const { listProjectMembers } = await import("./project-member.controller");

  const req = makeFakeRequest({ projectId: "someone-elses-project", userId: "user-1" });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await listProjectMembers(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
