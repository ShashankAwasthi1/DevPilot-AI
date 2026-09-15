import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_TASK_ID = "task-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";
const OUTSIDER_ID = "outsider-1";

const updateCalls: { where: unknown; data: Record<string, unknown> }[] = [];
let projectAccessRole: string = "OWNER";

function baseTaskRow() {
  return {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "Original title",
    description: "Original description",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    createdById: OWNER_ID,
    dueDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

// One shared mock for the whole file - see
// task.service.create.test.ts / conversation.service.update-title.test.ts
// for why a second t.mock.module call per file doesn't work here.
test("updateTask: an OWNER can update, and only the supplied fields are ever written", async (t) => {
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
          update: async (args: { where: unknown; data: Record<string, unknown> }) => {
            updateCalls.push(args);
            return { ...baseTaskRow(), ...args.data };
          },
        },
        project: {
          findUnique: async () => ({ ownerId: OWNER_ID }),
        },
        projectMember: {
          findUnique: async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) => {
            if (where.projectId_userId.userId === MEMBER_ID) {
              return { id: "membership-1", projectId: REAL_PROJECT_ID, userId: MEMBER_ID, role: "MEMBER" };
            }
            return null;
          },
        },
      },
    },
  });

  const { updateTask } = await import("./task.service");

  projectAccessRole = "OWNER";
  const result = await updateTask(REAL_USER_ID, REAL_TASK_ID, { status: "DONE" });

  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].where, { id: REAL_TASK_ID }, "must use the id resolved by getTaskAccess");
  assert.deepEqual(Object.keys(updateCalls[0].data), [
    "title",
    "description",
    "status",
    "priority",
    "assigneeId",
    "dueDate",
  ]);
  assert.equal(updateCalls[0].data.status, "DONE");
  assert.equal(updateCalls[0].data.title, undefined, "omitted fields must be undefined, never invented");
  assert.equal(result.status, "DONE");
});

test("updateTask: an ADMIN can update", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "ADMIN";
  const before = updateCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed" });

  assert.equal(updateCalls.length, before + 1);
});

test("updateTask: a MEMBER can update", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "MEMBER";
  const before = updateCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed" });

  assert.equal(updateCalls.length, before + 1);
});

test("updateTask: a VIEWER cannot update, and update is never attempted", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "VIEWER";
  const before = updateCalls.length;

  await assert.rejects(
    () => updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(updateCalls.length, before);
});

test("updateTask: omitted fields remain untouched (undefined, not written over)", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { priority: "URGENT" });

  const lastCall = updateCalls[updateCalls.length - 1];
  assert.equal(lastCall.data.priority, "URGENT");
  assert.equal(lastCall.data.title, undefined);
  assert.equal(lastCall.data.description, undefined);
  assert.equal(lastCall.data.status, undefined);
  assert.equal(lastCall.data.assigneeId, undefined);
  assert.equal(lastCall.data.dueDate, undefined);
});

test("updateTask: an explicit null description clears it", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { description: null });

  assert.equal(updateCalls[updateCalls.length - 1].data.description, null);
});

test("updateTask: an explicit null assigneeId unassigns", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  const result = await updateTask(REAL_USER_ID, REAL_TASK_ID, { assigneeId: null });

  assert.equal(updateCalls[updateCalls.length - 1].data.assigneeId, null);
  assert.equal(result.assigneeId, null);
});

test("updateTask: an explicit null dueDate clears it", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { dueDate: null });

  assert.equal(updateCalls[updateCalls.length - 1].data.dueDate, null);
});

test("updateTask: an ISO dueDate string becomes a Date", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { dueDate: "2026-05-01T00:00:00Z" });

  const written = updateCalls[updateCalls.length - 1].data.dueDate;
  assert.ok(written instanceof Date);
  assert.equal((written as Date).toISOString(), "2026-05-01T00:00:00.000Z");
});

test("updateTask: projectId cannot be changed through input (never part of the write)", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed" } as never);

  const lastCall = updateCalls[updateCalls.length - 1];
  assert.equal("projectId" in lastCall.data, false);
});

test("updateTask: createdById cannot be changed through input (never part of the write)", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed again" } as never);

  const lastCall = updateCalls[updateCalls.length - 1];
  assert.equal("createdById" in lastCall.data, false);
});

test("updateTask: an assigneeId that is not a project member is rejected, and update is never attempted", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  const before = updateCalls.length;

  await assert.rejects(
    () => updateTask(REAL_USER_ID, REAL_TASK_ID, { assigneeId: OUTSIDER_ID }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  assert.equal(updateCalls.length, before, "update must never be attempted for an out-of-project assignee");
});

test("updateTask: a nonexistent task id is rejected with the existing 404 behavior, and update is never attempted", async () => {
  const { updateTask } = await import("./task.service");
  const before = updateCalls.length;

  await assert.rejects(
    () => updateTask(REAL_USER_ID, "does-not-exist", { title: "Renamed" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(updateCalls.length, before);
});
