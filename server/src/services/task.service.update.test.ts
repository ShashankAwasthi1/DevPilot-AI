import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_TASK_ID = "task-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";
const MEMBER_2_ID = "member-2";
const OUTSIDER_ID = "outsider-1";

const updateCalls: { where: unknown; data: Record<string, unknown> }[] = [];
const notificationCalls: { userId: string; type: string; metadata: Record<string, unknown> }[] = [];
const activityCalls: { type: string; projectId: string; taskId?: string; actorId: string; metadata: unknown }[] = [];
let projectAccessRole: string = "OWNER";
// The pre-update task's assigneeId, as returned by getTaskAccess's own
// prisma.task.findUnique lookup - mutable per test (like projectAccessRole
// above) so the assignee-change tests can control what "the current
// assignee before this update" was.
let existingAssigneeId: string | null = null;

function baseTaskRow() {
  return {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "Original title",
    description: "Original description",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: existingAssigneeId,
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
  t.mock.module("./activity.service", {
    namedExports: {
      recordActivity: async (
        _client: unknown,
        args: { type: string; projectId: string; taskId?: string; actorId: string; metadata: unknown },
      ) => {
        activityCalls.push(args);
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
            const memberUserId = where.projectId_userId.userId;
            if (memberUserId === MEMBER_ID || memberUserId === MEMBER_2_ID) {
              return { id: "membership-1", projectId: REAL_PROJECT_ID, userId: memberUserId, role: "MEMBER" };
            }
            return null;
          },
        },
        // Real createNotification (./notification.service is never mocked
        // in this file) writes through this - only a plain capturing stub.
        notification: {
          create: async (args: { data: { userId: string; type: string; metadata: Record<string, unknown> } }) => {
            notificationCalls.push(args.data);
            return { id: "notification-1", ...args.data, readAt: null, createdAt: new Date() };
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

test("updateTask: changing the assignee from one user to another sends the new assignee a TASK_ASSIGNED notification", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = MEMBER_ID; // "A"
  const before = notificationCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { assigneeId: MEMBER_2_ID }); // -> "B"

  assert.equal(notificationCalls.length, before + 1);
  const notification = notificationCalls[notificationCalls.length - 1];
  assert.equal(notification.userId, MEMBER_2_ID, "only the new assignee (B) is notified, never the old one (A)");
  assert.equal(notification.type, "TASK_ASSIGNED");
  assert.deepEqual(notification.metadata, {
    taskId: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    actorId: REAL_USER_ID,
  });
});

test("updateTask: resending the same assigneeId (no actual change) never sends a duplicate notification", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = MEMBER_ID;
  const before = notificationCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { assigneeId: MEMBER_ID });

  assert.equal(notificationCalls.length, before, "an unchanged assigneeId must never trigger a notification");
});

test("updateTask: updating other fields without touching assigneeId never sends a notification", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = MEMBER_ID;
  const before = notificationCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, { title: "Renamed once more" });

  assert.equal(notificationCalls.length, before, "assigneeId omitted entirely must never trigger a notification");
});

test("updateTask: assigning to yourself never sends a notification", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "MEMBER";
  existingAssigneeId = MEMBER_2_ID;
  const before = notificationCalls.length;

  // MEMBER_ID is both the caller and the new assignee - a real
  // self-assignment during an update, not just a coincidental id match.
  await updateTask(MEMBER_ID, REAL_TASK_ID, { assigneeId: MEMBER_ID });

  assert.equal(notificationCalls.length, before, "self-assignment must never trigger a notification");
});

test("updateTask: a genuine field change records a TASK_UPDATED activity capturing the before/after values", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = null;
  const before = activityCalls.length;

  const result = await updateTask(REAL_USER_ID, REAL_TASK_ID, { status: "DONE", priority: "URGENT" });

  assert.equal(activityCalls.length, before + 1, "exactly one activity row per update call, never one per field");
  const activity = activityCalls[activityCalls.length - 1];
  assert.equal(activity.type, "TASK_UPDATED");
  assert.equal(activity.projectId, REAL_PROJECT_ID);
  assert.equal(activity.taskId, REAL_TASK_ID);
  assert.equal(activity.actorId, REAL_USER_ID);
  assert.deepEqual(activity.metadata, {
    taskId: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    actorId: REAL_USER_ID,
    changes: {
      status: { from: "TODO", to: "DONE" },
      priority: { from: "MEDIUM", to: "URGENT" },
    },
  });
  assert.equal(result.status, "DONE");
});

test("updateTask: resending a field's existing value (no actual change) never records a duplicate activity", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = null;
  const before = activityCalls.length;

  // baseTaskRow() already has status "TODO" and priority "MEDIUM" - this
  // resends the exact current values, same as an unrelated field being
  // resubmitted unchanged by a client-side form.
  await updateTask(REAL_USER_ID, REAL_TASK_ID, { status: "TODO", priority: "MEDIUM" });

  assert.equal(activityCalls.length, before, "no genuine change means no activity row, never a noisy no-op entry");
});

test("updateTask: an update with no fields at all never records an activity", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = null;
  const before = activityCalls.length;

  await updateTask(REAL_USER_ID, REAL_TASK_ID, {});

  assert.equal(activityCalls.length, before);
});

test("updateTask: an unchanged dueDate (already null, resent as null) never records an activity", async () => {
  const { updateTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  existingAssigneeId = null;
  const before = activityCalls.length;

  // baseTaskRow() already has dueDate: null.
  await updateTask(REAL_USER_ID, REAL_TASK_ID, { dueDate: null });

  assert.equal(activityCalls.length, before, "resending the same (null) dueDate must never count as a change");
});
