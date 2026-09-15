import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_TASK_ID = "task-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";

const deleteCalls: { where: unknown }[] = [];
let projectAccessRole: string = "OWNER";

function baseTaskRow() {
  return {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "A task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    createdById: OWNER_ID,
    dueDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

// One shared mock for the whole file - same module-cache constraint as
// task.service.create.test.ts / task.service.update.test.ts.
test("deleteTask: an OWNER can delete via a genuine hard delete, using the id resolved by getTaskAccess", async (t) => {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { id: REAL_PROJECT_ID, ownerId: OWNER_ID }, role: projectAccessRole }),
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
        task: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            if (where.id === REAL_TASK_ID) return baseTaskRow();
            return null;
          },
          delete: async (args: { where: unknown }) => {
            deleteCalls.push(args);
            return baseTaskRow();
          },
        },
      },
    },
  });

  const { deleteTask } = await import("./task.service");

  projectAccessRole = "OWNER";
  await deleteTask(REAL_USER_ID, REAL_TASK_ID);

  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0].where, { id: REAL_TASK_ID });
});

test("deleteTask: an ADMIN can delete", async () => {
  const { deleteTask } = await import("./task.service");
  projectAccessRole = "ADMIN";
  const before = deleteCalls.length;

  await deleteTask(REAL_USER_ID, REAL_TASK_ID);

  assert.equal(deleteCalls.length, before + 1);
});

test("deleteTask: a MEMBER can delete", async () => {
  const { deleteTask } = await import("./task.service");
  projectAccessRole = "MEMBER";
  const before = deleteCalls.length;

  await deleteTask(REAL_USER_ID, REAL_TASK_ID);

  assert.equal(deleteCalls.length, before + 1);
});

test("deleteTask: a VIEWER cannot delete, and delete is never attempted", async () => {
  const { deleteTask } = await import("./task.service");
  projectAccessRole = "VIEWER";
  const before = deleteCalls.length;

  await assert.rejects(
    () => deleteTask(REAL_USER_ID, REAL_TASK_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(deleteCalls.length, before, "delete must never be attempted for a rejected role");
});

test("deleteTask: a nonexistent task id remains a 404, and delete is never attempted", async () => {
  const { deleteTask } = await import("./task.service");
  const before = deleteCalls.length;

  await assert.rejects(
    () => deleteTask(REAL_USER_ID, "does-not-exist"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(deleteCalls.length, before);
});
