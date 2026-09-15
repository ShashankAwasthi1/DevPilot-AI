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
