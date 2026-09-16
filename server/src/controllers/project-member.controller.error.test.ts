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

// "./project-member.controller" is only evaluated once per resolved
// specifier - a later t.mock.module call doesn't retroactively change the
// bindings the first import already captured (same constraint documented
// in project-member.service.test.ts). A unique query string forces a
// fresh module instance per test.
function importFreshController() {
  return import(`./project-member.controller?test=${Math.random()}`) as Promise<
    typeof import("./project-member.controller")
  >;
}

test("addProjectMember: forwards a service failure (e.g. 403 for a non-OWNER/ADMIN caller) to next(err) rather than creating a membership", async (t) => {
  class FakeAppError extends Error {
    statusCode = 403;
  }

  t.mock.module("../services/project-member.service", {
    namedExports: {
      addProjectMember: async () => {
        throw new FakeAppError("You do not have permission to perform this action");
      },
    },
  });

  const { addProjectMember } = await importFreshController();

  const req = {
    params: { id: "project-1" },
    user: { id: "member-1" },
    body: { email: "someone@example.com", role: "MEMBER" },
  } as unknown as Request;
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await addProjectMember(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 403);
});

test("updateProjectMemberRole: forwards a service failure (e.g. 409 for the project owner) to next(err) rather than updating anything", async (t) => {
  class FakeAppError extends Error {
    statusCode = 409;
  }

  t.mock.module("../services/project-member.service", {
    namedExports: {
      updateProjectMemberRole: async () => {
        throw new FakeAppError("The project owner's role cannot be changed");
      },
    },
  });

  const { updateProjectMemberRole } = await importFreshController();

  const req = {
    params: { id: "project-1", userId: "owner-of-that-project" },
    user: { id: "owner-1" },
    body: { role: "ADMIN" },
  } as unknown as Request;
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await updateProjectMemberRole(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 409);
});

test("removeProjectMember: forwards a service failure (e.g. 404 for a non-member target) to next(err) rather than deleting anything", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/project-member.service", {
    namedExports: {
      removeProjectMember: async () => {
        throw new FakeAppError("Project member not found");
      },
    },
  });

  const { removeProjectMember } = await importFreshController();

  const req = {
    params: { id: "project-1", userId: "not-a-member" },
    user: { id: "owner-1" },
  } as unknown as Request;
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await removeProjectMember(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
