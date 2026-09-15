import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse, throwingNext } from "./test-helpers";

function makeFakeRequest(options: { projectId: string; userId: string }): Request {
  return {
    params: { id: options.projectId },
    user: { id: options.userId },
  } as unknown as Request;
}

test("listProjectMembers: calls the service with the authenticated userId and the route project id, and returns 200 with the member list", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/project-member.service", {
    namedExports: {
      listProjectMembers: async (...args: unknown[]) => {
        recordedArgs = args;
        return [{ userId: "owner-1", name: "Olivia Owner", email: "olivia@example.com", role: "OWNER" }];
      },
    },
  });

  const { listProjectMembers } = await import("./project-member.controller");

  const req = makeFakeRequest({ projectId: "project-1", userId: "user-1" });
  const { res, state } = makeFakeJsonResponse();

  await listProjectMembers(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["user-1", "project-1"]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { members: [{ userId: "owner-1", name: "Olivia Owner", email: "olivia@example.com", role: "OWNER" }] },
  });
});
