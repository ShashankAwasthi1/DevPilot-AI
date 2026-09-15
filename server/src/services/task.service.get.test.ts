import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_TASK_ID = "task-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";
const OTHER_PROJECT_ID = "project-2";

function fullTaskRow() {
  return {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "Ship the release",
    description: "Cut the release branch and tag it",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeId: "member-1",
    createdById: OWNER_ID,
    dueDate: new Date("2026-03-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

// One shared mock for the whole file - a second t.mock.module call
// targeting an already-imported module wouldn't affect the cached
// task.service module (same module-cache constraint documented in
// conversation.service.update-title.test.ts and this file's siblings).
test("getTask: an authorized user (any role, e.g. VIEWER) receives the full TaskDto with every expected field", async (t) => {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async (projectId: string) => {
        if (projectId === REAL_PROJECT_ID) {
          return { project: { id: REAL_PROJECT_ID, ownerId: OWNER_ID }, role: "VIEWER" };
        }
        throw new AppError(404, "Project not found");
      },
      assertRole: () => {},
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        task: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            if (where.id === REAL_TASK_ID) return fullTaskRow();
            if (where.id === "foreign-task") {
              return { ...fullTaskRow(), id: "foreign-task", projectId: OTHER_PROJECT_ID };
            }
            return null;
          },
        },
      },
    },
  });

  const { getTask } = await import("./task.service");

  const result = await getTask(REAL_USER_ID, REAL_TASK_ID);

  assert.deepEqual(result, {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "Ship the release",
    description: "Cut the release branch and tag it",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeId: "member-1",
    createdById: OWNER_ID,
    dueDate: new Date("2026-03-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });

  // Only ever the exact fields TaskDto declares - never an arbitrary
  // Prisma column (e.g. no raw internal field could leak through here).
  assert.deepEqual(Object.keys(result).sort(), [
    "assigneeId",
    "createdAt",
    "createdById",
    "description",
    "dueDate",
    "id",
    "priority",
    "projectId",
    "status",
    "title",
    "updatedAt",
  ]);
});

test("getTask: a nonexistent task id is rejected with the existing 404 behavior", async () => {
  const { getTask } = await import("./task.service");

  await assert.rejects(
    () => getTask(REAL_USER_ID, "does-not-exist"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("getTask: a task belonging to a project the caller has no access to is rejected with 404, not 403 (never reveals the task exists)", async () => {
  const { getTask } = await import("./task.service");

  // "foreign-task" resolves to OTHER_PROJECT_ID (see the shared mock
  // above), and the mocked getProjectAccess only succeeds for
  // REAL_PROJECT_ID - so this exercises the exact same 404 path a
  // nonexistent task would take, never a distinguishable 403.
  await assert.rejects(
    () => getTask("someone-else", "foreign-task"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});
