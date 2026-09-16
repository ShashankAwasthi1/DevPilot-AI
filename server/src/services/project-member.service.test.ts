import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";

// One shared mock for the whole file - a second t.mock.module call
// targeting an already-imported module wouldn't affect the cached
// project-member.service module (same module-cache constraint documented
// throughout this test suite, e.g. task.service.get.test.ts).
test("listProjectMembers: returns the project owner plus every real ProjectMember row, mapping only the intended DTO fields", async (t) => {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async (projectId: string) => {
        if (projectId === REAL_PROJECT_ID) {
          return { project: { id: REAL_PROJECT_ID, ownerId: OWNER_ID }, role: "OWNER" };
        }
        throw new AppError(404, "Project not found");
      },
    },
  });

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            if (where.id === OWNER_ID) {
              return { id: OWNER_ID, name: "Olivia Owner", email: "olivia@example.com", passwordHash: "secret-hash" };
            }
            return null;
          },
        },
        projectMember: {
          findMany: async ({ where }: { where: { projectId: string } }) => {
            if (where.projectId !== REAL_PROJECT_ID) return [];
            return [
              {
                id: "membership-1",
                projectId: REAL_PROJECT_ID,
                userId: "member-1",
                role: "MEMBER",
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                user: { id: "member-1", name: "Mira Member", email: "mira@example.com" },
              },
              {
                id: "membership-2",
                projectId: REAL_PROJECT_ID,
                userId: "viewer-1",
                role: "VIEWER",
                createdAt: new Date("2026-01-02T00:00:00.000Z"),
                user: { id: "viewer-1", name: null, email: "viewer@example.com" },
              },
            ];
          },
        },
      },
    },
  });

  const { listProjectMembers } = await import("./project-member.service");

  const result = await listProjectMembers(REAL_USER_ID, REAL_PROJECT_ID);

  assert.deepEqual(result, [
    { userId: OWNER_ID, name: "Olivia Owner", email: "olivia@example.com", role: "OWNER" },
    { userId: "member-1", name: "Mira Member", email: "mira@example.com", role: "MEMBER" },
    { userId: "viewer-1", name: null, email: "viewer@example.com", role: "VIEWER" },
  ]);

  // Only the intended DTO fields ever appear - never a raw Prisma field
  // like passwordHash, even though the mocked user row above includes one.
  for (const member of result) {
    assert.deepEqual(Object.keys(member).sort(), ["email", "name", "role", "userId"]);
  }
});

test("listProjectMembers: an inaccessible/nonexistent project is rejected with the existing 404 behavior, and no member data is returned", async () => {
  const { listProjectMembers } = await import("./project-member.service");

  await assert.rejects(
    () => listProjectMembers("someone-else", "someone-elses-project"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

// --- addProjectMember -------------------------------------------------

const TARGET_EMAIL = "newmember@example.com";
const TARGET_USER_ID = "target-user-1";

interface FakeAccess {
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  ownerId?: string;
}

// "./project-member.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same constraint
// noted in ai/local-embedding-provider.test.ts). A unique query string per
// test forces a fresh module instance, so each test's own mocks actually
// take effect.
let importCounter = 0;
function importFreshAddProjectMember() {
  return import(`./project-member.service?test=${importCounter++}`) as Promise<
    typeof import("./project-member.service")
  >;
}

function mockAddMemberModules(
  t: import("node:test").TestContext,
  access: FakeAccess,
  options: {
    findUniqueUser?: (args: { where: { email: string } }) => Promise<unknown>;
    findUniqueMembership?: (args: unknown) => Promise<unknown>;
    create?: (args: unknown) => Promise<unknown>;
  } = {},
) {
  const ownerId = access.ownerId ?? OWNER_ID;

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { id: REAL_PROJECT_ID, ownerId }, role: access.role }),
      // The real assertRole - re-imported here rather than re-implemented,
      // so these tests exercise the actual 403 logic, not a stand-in for it.
      assertRole: (role: string, allowed: string[]) => {
        if (!allowed.includes(role)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique:
            options.findUniqueUser ??
            (async ({ where }: { where: { email: string } }) =>
              where.email === TARGET_EMAIL
                ? { id: TARGET_USER_ID, name: "New Member", email: TARGET_EMAIL }
                : null),
        },
        projectMember: {
          findUnique: options.findUniqueMembership ?? (async () => null),
          create:
            options.create ??
            (async ({ data }: { data: { userId: string; role: string } }) => ({
              id: "new-membership",
              projectId: REAL_PROJECT_ID,
              userId: data.userId,
              role: data.role,
              createdAt: new Date("2026-01-03T00:00:00.000Z"),
            })),
        },
      },
    },
  });
}

test("addProjectMember: OWNER can add a MEMBER", async (t) => {
  mockAddMemberModules(t, { role: "OWNER" });
  const { addProjectMember } = await importFreshAddProjectMember();

  const result = await addProjectMember(OWNER_ID, REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" });

  assert.deepEqual(result, { userId: TARGET_USER_ID, name: "New Member", email: TARGET_EMAIL, role: "MEMBER" });
  assert.deepEqual(Object.keys(result).sort(), ["email", "name", "role", "userId"]);
});

test("addProjectMember: ADMIN can add a MEMBER", async (t) => {
  mockAddMemberModules(t, { role: "ADMIN" });
  const { addProjectMember } = await importFreshAddProjectMember();

  const result = await addProjectMember("admin-1", REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" });

  assert.equal(result.role, "MEMBER");
  assert.equal(result.userId, TARGET_USER_ID);
});

test("addProjectMember: MEMBER receives 403", async (t) => {
  mockAddMemberModules(t, { role: "MEMBER" });
  const { addProjectMember } = await importFreshAddProjectMember();

  await assert.rejects(
    () => addProjectMember("member-1", REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("addProjectMember: VIEWER receives 403", async (t) => {
  mockAddMemberModules(t, { role: "VIEWER" });
  const { addProjectMember } = await importFreshAddProjectMember();

  await assert.rejects(
    () => addProjectMember("viewer-1", REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("addProjectMember: a non-existent target email is rejected with 404 and no membership is created", async (t) => {
  let createCalled = false;
  mockAddMemberModules(t, { role: "OWNER" }, {
    findUniqueUser: async () => null,
    create: async () => {
      createCalled = true;
      throw new Error("create should never be called");
    },
  });
  const { addProjectMember } = await importFreshAddProjectMember();

  await assert.rejects(
    () => addProjectMember(OWNER_ID, REAL_PROJECT_ID, { email: "nobody@example.com", role: "MEMBER" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
  assert.equal(createCalled, false);
});

test("addProjectMember: an already-existing member cannot be added twice (409)", async (t) => {
  let createCalled = false;
  mockAddMemberModules(t, { role: "OWNER" }, {
    findUniqueMembership: async () => ({
      id: "existing-membership",
      projectId: REAL_PROJECT_ID,
      userId: TARGET_USER_ID,
      role: "VIEWER",
      createdAt: new Date(),
    }),
    create: async () => {
      createCalled = true;
      throw new Error("create should never be called");
    },
  });
  const { addProjectMember } = await importFreshAddProjectMember();

  await assert.rejects(
    () => addProjectMember(OWNER_ID, REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
  assert.equal(createCalled, false);
});

test("addProjectMember: the project owner cannot be added as a ProjectMember (409), and no membership row is created", async (t) => {
  let createCalled = false;
  mockAddMemberModules(
    t,
    { role: "OWNER", ownerId: TARGET_USER_ID },
    {
      create: async () => {
        createCalled = true;
        throw new Error("create should never be called");
      },
    },
  );
  const { addProjectMember } = await importFreshAddProjectMember();

  await assert.rejects(
    () => addProjectMember(OWNER_ID, REAL_PROJECT_ID, { email: TARGET_EMAIL, role: "MEMBER" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
  assert.equal(createCalled, false);
});

// --- updateProjectMemberRole -------------------------------------------

function importFreshUpdateMemberRole() {
  return import(`./project-member.service?test=${importCounter++}`) as Promise<
    typeof import("./project-member.service")
  >;
}

function mockUpdateRoleModules(
  t: import("node:test").TestContext,
  access: FakeAccess,
  options: {
    findUniqueMembership?: (args: unknown) => Promise<unknown>;
    update?: (args: unknown) => Promise<unknown>;
  } = {},
) {
  const ownerId = access.ownerId ?? OWNER_ID;

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { id: REAL_PROJECT_ID, ownerId }, role: access.role }),
      assertRole: (role: string, allowed: string[]) => {
        if (!allowed.includes(role)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        projectMember: {
          findUnique:
            options.findUniqueMembership ??
            (async () => ({
              id: "existing-membership",
              projectId: REAL_PROJECT_ID,
              userId: TARGET_USER_ID,
              role: "VIEWER",
              createdAt: new Date("2026-01-02T00:00:00.000Z"),
              user: { id: TARGET_USER_ID, name: "Target Member", email: TARGET_EMAIL },
            })),
          update:
            options.update ??
            (async ({ data }: { data: { role: string } }) => ({
              id: "existing-membership",
              projectId: REAL_PROJECT_ID,
              userId: TARGET_USER_ID,
              role: data.role,
              createdAt: new Date("2026-01-02T00:00:00.000Z"),
            })),
        },
      },
    },
  });
}

test("updateProjectMemberRole: OWNER can update a member's role", async (t) => {
  mockUpdateRoleModules(t, { role: "OWNER" });
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  const result = await updateProjectMemberRole(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID, { role: "ADMIN" });

  assert.deepEqual(result, { userId: TARGET_USER_ID, name: "Target Member", email: TARGET_EMAIL, role: "ADMIN" });
  assert.deepEqual(Object.keys(result).sort(), ["email", "name", "role", "userId"]);
});

// Per this codebase's RBAC model (assertRole: does the caller's role
// appear in the allowed list, never a target-relative check), an ADMIN
// can change any non-owner member's role, including another ADMIN's -
// same as updateProjectMemberRole's own top comment explains.
test("updateProjectMemberRole: ADMIN can update another member's role (including another ADMIN's, per the chosen RBAC rule)", async (t) => {
  mockUpdateRoleModules(t, { role: "ADMIN" });
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  const result = await updateProjectMemberRole("admin-1", REAL_PROJECT_ID, TARGET_USER_ID, { role: "VIEWER" });

  assert.equal(result.role, "VIEWER");
  assert.equal(result.userId, TARGET_USER_ID);
});

test("updateProjectMemberRole: MEMBER receives 403", async (t) => {
  mockUpdateRoleModules(t, { role: "MEMBER" });
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  await assert.rejects(
    () => updateProjectMemberRole("member-1", REAL_PROJECT_ID, TARGET_USER_ID, { role: "ADMIN" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("updateProjectMemberRole: VIEWER receives 403", async (t) => {
  mockUpdateRoleModules(t, { role: "VIEWER" });
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  await assert.rejects(
    () => updateProjectMemberRole("viewer-1", REAL_PROJECT_ID, TARGET_USER_ID, { role: "ADMIN" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("updateProjectMemberRole: a nonexistent target member is rejected with 404, and no update is performed", async (t) => {
  let updateCalled = false;
  mockUpdateRoleModules(t, { role: "OWNER" }, {
    findUniqueMembership: async () => null,
    update: async () => {
      updateCalled = true;
      throw new Error("update should never be called");
    },
  });
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  await assert.rejects(
    () => updateProjectMemberRole(OWNER_ID, REAL_PROJECT_ID, "not-a-member", { role: "ADMIN" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
  assert.equal(updateCalled, false);
});

test("updateProjectMemberRole: the project owner's role cannot be changed (409), and no membership lookup/update is performed", async (t) => {
  let updateCalled = false;
  mockUpdateRoleModules(
    t,
    { role: "OWNER", ownerId: TARGET_USER_ID },
    {
      findUniqueMembership: async () => {
        throw new Error("findUnique should never be called for the owner");
      },
      update: async () => {
        updateCalled = true;
        throw new Error("update should never be called");
      },
    },
  );
  const { updateProjectMemberRole } = await importFreshUpdateMemberRole();

  await assert.rejects(
    () => updateProjectMemberRole(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID, { role: "ADMIN" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
  assert.equal(updateCalled, false);
});

// --- removeProjectMember ------------------------------------------------

function importFreshRemoveMember() {
  return import(`./project-member.service?test=${importCounter++}`) as Promise<
    typeof import("./project-member.service")
  >;
}

function mockRemoveMemberModules(
  t: import("node:test").TestContext,
  access: FakeAccess,
  options: {
    membershipRole?: "ADMIN" | "MEMBER" | "VIEWER";
    findUniqueMembership?: (args: unknown) => Promise<unknown>;
    deleteFn?: (args: unknown) => Promise<unknown>;
  } = {},
) {
  const ownerId = access.ownerId ?? OWNER_ID;
  let userDeleted = false;
  let otherProjectMembershipDeleted = false;

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { id: REAL_PROJECT_ID, ownerId }, role: access.role }),
      assertRole: (role: string, allowed: string[]) => {
        if (!allowed.includes(role)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        // Neither the User model nor a different project's membership row
        // is ever touched by removeProjectMember - this mock exists purely
        // so a test can assert it was never called.
        user: {
          delete: async () => {
            userDeleted = true;
            throw new Error("user.delete should never be called by removeProjectMember");
          },
        },
        projectMember: {
          findUnique:
            options.findUniqueMembership ??
            (async () => ({
              id: "existing-membership",
              projectId: REAL_PROJECT_ID,
              userId: TARGET_USER_ID,
              role: options.membershipRole ?? "VIEWER",
              createdAt: new Date("2026-01-02T00:00:00.000Z"),
              user: { id: TARGET_USER_ID, name: "Target Member", email: TARGET_EMAIL },
            })),
          delete:
            options.deleteFn ??
            (async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) => {
              if (where.projectId_userId.projectId !== REAL_PROJECT_ID) {
                otherProjectMembershipDeleted = true;
              }
              return {
                id: "existing-membership",
                projectId: where.projectId_userId.projectId,
                userId: where.projectId_userId.userId,
                role: options.membershipRole ?? "VIEWER",
                createdAt: new Date("2026-01-02T00:00:00.000Z"),
              };
            }),
        },
      },
    },
  });

  return {
    wasUserDeleted: () => userDeleted,
    wasOtherProjectMembershipDeleted: () => otherProjectMembershipDeleted,
  };
}

test("removeProjectMember: OWNER can remove a MEMBER", async (t) => {
  mockRemoveMemberModules(t, { role: "OWNER" }, { membershipRole: "MEMBER" });
  const { removeProjectMember } = await importFreshRemoveMember();

  const result = await removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID);

  assert.deepEqual(result, { userId: TARGET_USER_ID, name: "Target Member", email: TARGET_EMAIL, role: "MEMBER" });
  assert.deepEqual(Object.keys(result).sort(), ["email", "name", "role", "userId"]);
});

test("removeProjectMember: OWNER can remove an ADMIN", async (t) => {
  mockRemoveMemberModules(t, { role: "OWNER" }, { membershipRole: "ADMIN" });
  const { removeProjectMember } = await importFreshRemoveMember();

  const result = await removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID);

  assert.equal(result.role, "ADMIN");
  assert.equal(result.userId, TARGET_USER_ID);
});

test("removeProjectMember: ADMIN can remove a MEMBER", async (t) => {
  mockRemoveMemberModules(t, { role: "ADMIN" }, { membershipRole: "MEMBER" });
  const { removeProjectMember } = await importFreshRemoveMember();

  const result = await removeProjectMember("admin-1", REAL_PROJECT_ID, TARGET_USER_ID);

  assert.equal(result.role, "MEMBER");
});

// Same RBAC rule as updateProjectMemberRole: no target-relative
// restriction, so an ADMIN can remove another ADMIN too.
test("removeProjectMember: ADMIN can remove another ADMIN, consistent with updateProjectMemberRole's RBAC rule", async (t) => {
  mockRemoveMemberModules(t, { role: "ADMIN" }, { membershipRole: "ADMIN" });
  const { removeProjectMember } = await importFreshRemoveMember();

  const result = await removeProjectMember("admin-1", REAL_PROJECT_ID, TARGET_USER_ID);

  assert.equal(result.role, "ADMIN");
});

test("removeProjectMember: MEMBER receives 403", async (t) => {
  mockRemoveMemberModules(t, { role: "MEMBER" });
  const { removeProjectMember } = await importFreshRemoveMember();

  await assert.rejects(
    () => removeProjectMember("member-1", REAL_PROJECT_ID, TARGET_USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("removeProjectMember: VIEWER receives 403", async (t) => {
  mockRemoveMemberModules(t, { role: "VIEWER" });
  const { removeProjectMember } = await importFreshRemoveMember();

  await assert.rejects(
    () => removeProjectMember("viewer-1", REAL_PROJECT_ID, TARGET_USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test("removeProjectMember: removing the project owner is rejected with 409, and no membership lookup/delete is performed", async (t) => {
  let deleteCalled = false;
  mockRemoveMemberModules(
    t,
    { role: "OWNER", ownerId: TARGET_USER_ID },
    {
      findUniqueMembership: async () => {
        throw new Error("findUnique should never be called for the owner");
      },
      deleteFn: async () => {
        deleteCalled = true;
        throw new Error("delete should never be called");
      },
    },
  );
  const { removeProjectMember } = await importFreshRemoveMember();

  await assert.rejects(
    () => removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
  assert.equal(deleteCalled, false);
});

test("removeProjectMember: a nonexistent/non-member target is rejected with 404, and no delete is performed", async (t) => {
  let deleteCalled = false;
  mockRemoveMemberModules(t, { role: "OWNER" }, {
    findUniqueMembership: async () => null,
    deleteFn: async () => {
      deleteCalled = true;
      throw new Error("delete should never be called");
    },
  });
  const { removeProjectMember } = await importFreshRemoveMember();

  await assert.rejects(
    () => removeProjectMember(OWNER_ID, REAL_PROJECT_ID, "not-a-member"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
  assert.equal(deleteCalled, false);
});

test("removeProjectMember: actually deletes the membership row (via the compound projectId_userId key)", async (t) => {
  let deleteArgs: unknown;
  mockRemoveMemberModules(t, { role: "OWNER" }, {
    deleteFn: async (args: unknown) => {
      deleteArgs = args;
      return {
        id: "existing-membership",
        projectId: REAL_PROJECT_ID,
        userId: TARGET_USER_ID,
        role: "VIEWER",
        createdAt: new Date(),
      };
    },
  });
  const { removeProjectMember } = await importFreshRemoveMember();

  await removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID);

  assert.deepEqual(deleteArgs, { where: { projectId_userId: { projectId: REAL_PROJECT_ID, userId: TARGET_USER_ID } } });
});

test("removeProjectMember: never deletes the User record itself", async (t) => {
  const spies = mockRemoveMemberModules(t, { role: "OWNER" });
  const { removeProjectMember } = await importFreshRemoveMember();

  await removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID);

  assert.equal(spies.wasUserDeleted(), false);
});

test("removeProjectMember: only deletes the membership for this specific project/user pair, never another project's membership for the same user", async (t) => {
  const OTHER_PROJECT_ID = "project-2";
  let deleteArgs: unknown;
  const spies = mockRemoveMemberModules(t, { role: "OWNER" }, {
    deleteFn: async (args: unknown) => {
      deleteArgs = args;
      return {
        id: "existing-membership",
        projectId: REAL_PROJECT_ID,
        userId: TARGET_USER_ID,
        role: "VIEWER",
        createdAt: new Date(),
      };
    },
  });
  const { removeProjectMember } = await importFreshRemoveMember();

  await removeProjectMember(OWNER_ID, REAL_PROJECT_ID, TARGET_USER_ID);

  assert.deepEqual(
    (deleteArgs as { where: { projectId_userId: { projectId: string; userId: string } } }).where.projectId_userId,
    { projectId: REAL_PROJECT_ID, userId: TARGET_USER_ID },
  );
  assert.notEqual(
    (deleteArgs as { where: { projectId_userId: { projectId: string } } }).where.projectId_userId.projectId,
    OTHER_PROJECT_ID,
  );
  assert.equal(spies.wasOtherProjectMembershipDeleted(), false);
});
