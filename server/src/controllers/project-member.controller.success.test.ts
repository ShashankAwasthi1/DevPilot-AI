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

// "./project-member.controller" is only evaluated once per resolved
// specifier - a later t.mock.module call doesn't retroactively change the
// bindings the first import already captured (same constraint documented
// in project-member.service.test.ts). A unique query string per test
// forces a fresh module instance.
let importCounter = 0;
function importFreshController() {
  return import(`./project-member.controller?test=${importCounter++}`) as Promise<
    typeof import("./project-member.controller")
  >;
}

function makeFakeAddMemberRequest(options: {
  projectId: string;
  userId: string;
  body: Record<string, unknown>;
}): Request {
  return {
    params: { id: options.projectId },
    user: { id: options.userId },
    body: options.body,
  } as unknown as Request;
}

test("addProjectMember: calls the service with the authenticated userId, route project id, and validated body, and returns 201 with the created member", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/project-member.service", {
    namedExports: {
      addProjectMember: async (...args: unknown[]) => {
        recordedArgs = args;
        return { userId: "new-user-1", name: "New Member", email: "new@example.com", role: "MEMBER" };
      },
    },
  });

  const { addProjectMember } = await importFreshController();

  const req = makeFakeAddMemberRequest({
    projectId: "project-1",
    userId: "owner-1",
    body: { email: "new@example.com", role: "MEMBER" },
  });
  const { res, state } = makeFakeJsonResponse();

  await addProjectMember(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["owner-1", "project-1", { email: "new@example.com", role: "MEMBER" }]);
  assert.equal(state.statusCode, 201);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { member: { userId: "new-user-1", name: "New Member", email: "new@example.com", role: "MEMBER" } },
  });
});

function makeFakeUpdateRoleRequest(options: {
  projectId: string;
  targetUserId: string;
  userId: string;
  body: Record<string, unknown>;
}): Request {
  return {
    params: { id: options.projectId, userId: options.targetUserId },
    user: { id: options.userId },
    body: options.body,
  } as unknown as Request;
}

test("updateProjectMemberRole: calls the service with the authenticated userId, route project id, target userId, and validated body, and returns 200 with the updated member", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/project-member.service", {
    namedExports: {
      updateProjectMemberRole: async (...args: unknown[]) => {
        recordedArgs = args;
        return { userId: "target-1", name: "Target Member", email: "target@example.com", role: "ADMIN" };
      },
    },
  });

  const { updateProjectMemberRole } = await importFreshController();

  const req = makeFakeUpdateRoleRequest({
    projectId: "project-1",
    targetUserId: "target-1",
    userId: "owner-1",
    body: { role: "ADMIN" },
  });
  const { res, state } = makeFakeJsonResponse();

  await updateProjectMemberRole(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["owner-1", "project-1", "target-1", { role: "ADMIN" }]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { member: { userId: "target-1", name: "Target Member", email: "target@example.com", role: "ADMIN" } },
  });
});

function makeFakeRemoveMemberRequest(options: { projectId: string; targetUserId: string; userId: string }): Request {
  return {
    params: { id: options.projectId, userId: options.targetUserId },
    user: { id: options.userId },
  } as unknown as Request;
}

test("removeProjectMember: calls the service with the authenticated userId, route project id, and target userId, and returns 200 with the removed member", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/project-member.service", {
    namedExports: {
      removeProjectMember: async (...args: unknown[]) => {
        recordedArgs = args;
        return { userId: "target-1", name: "Target Member", email: "target@example.com", role: "MEMBER" };
      },
    },
  });

  const { removeProjectMember } = await importFreshController();

  const req = makeFakeRemoveMemberRequest({ projectId: "project-1", targetUserId: "target-1", userId: "owner-1" });
  const { res, state } = makeFakeJsonResponse();

  await removeProjectMember(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["owner-1", "project-1", "target-1"]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: { member: { userId: "target-1", name: "Target Member", email: "target@example.com", role: "MEMBER" } },
  });
});
