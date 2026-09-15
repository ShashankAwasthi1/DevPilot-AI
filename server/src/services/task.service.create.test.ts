import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_USER_ID = "user-1";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";
const OUTSIDER_ID = "outsider-1";

const createCalls: { data: Record<string, unknown> }[] = [];
let projectAccessRole: string = "OWNER";
let getProjectAccessCalls = 0;

// One shared mock for the whole file, branching on caller/assignee ids -
// a second t.mock.module call targeting an already-imported module would
// not affect the cached task.service module (same module-cache constraint
// documented in conversation.service.update-title.test.ts).
test("createTask: an OWNER can create a task, and projectId/createdById come from the arguments, never from input", async (t) => {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => {
        getProjectAccessCalls += 1;
        return { project: { id: REAL_PROJECT_ID, ownerId: OWNER_ID }, role: projectAccessRole };
      },
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
        task: {
          create: async (args: { data: Record<string, unknown> }) => {
            createCalls.push(args);
            return {
              id: "task-1",
              projectId: args.data.projectId,
              title: args.data.title,
              description: args.data.description ?? null,
              status: args.data.status,
              priority: args.data.priority,
              assigneeId: args.data.assigneeId ?? null,
              createdById: args.data.createdById,
              dueDate: args.data.dueDate ?? null,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            };
          },
        },
      },
    },
  });

  const { createTask } = await import("./task.service");

  projectAccessRole = "OWNER";
  const result = await createTask(REAL_USER_ID, REAL_PROJECT_ID, {
    title: "Ship the release",
    status: "TODO",
    priority: "MEDIUM",
  });

  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].data.projectId, REAL_PROJECT_ID, "projectId must come from the argument, not input");
  assert.equal(createCalls[0].data.createdById, REAL_USER_ID, "createdById must come from the authenticated userId");
  assert.equal(result.projectId, REAL_PROJECT_ID);
  assert.equal(result.createdById, REAL_USER_ID);
});

test("createTask: an ADMIN can create a task", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "ADMIN";
  const before = createCalls.length;

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, { title: "Task", status: "TODO", priority: "MEDIUM" });

  assert.equal(createCalls.length, before + 1);
});

test("createTask: a MEMBER can create a task", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "MEMBER";
  const before = createCalls.length;

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, { title: "Task", status: "TODO", priority: "MEDIUM" });

  assert.equal(createCalls.length, before + 1);
});

test("createTask: a VIEWER cannot create a task, and create is never attempted", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "VIEWER";
  const before = createCalls.length;

  await assert.rejects(
    () => createTask(REAL_USER_ID, REAL_PROJECT_ID, { title: "Task", status: "TODO", priority: "MEDIUM" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(createCalls.length, before, "create must never be attempted for a rejected role");
});

test("createTask: title/description/status/priority are written exactly as provided, and dueDate ISO string becomes a Date", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  const result = await createTask(REAL_USER_ID, REAL_PROJECT_ID, {
    title: "Write the report",
    description: "Quarterly report for stakeholders",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: "2026-03-01T00:00:00Z",
  });

  const lastCall = createCalls[createCalls.length - 1];
  assert.equal(lastCall.data.title, "Write the report");
  assert.equal(lastCall.data.description, "Quarterly report for stakeholders");
  assert.equal(lastCall.data.status, "IN_PROGRESS");
  assert.equal(lastCall.data.priority, "HIGH");
  assert.ok(lastCall.data.dueDate instanceof Date);
  assert.equal((lastCall.data.dueDate as Date).toISOString(), "2026-03-01T00:00:00.000Z");
  assert.equal(result.dueDate instanceof Date, true);
});

test("createTask: explicit null description/assigneeId/dueDate are preserved as null, not dropped", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, {
    title: "Task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    dueDate: null,
  });

  const lastCall = createCalls[createCalls.length - 1];
  assert.equal(lastCall.data.description, null);
  assert.equal(lastCall.data.assigneeId, null);
  assert.equal(lastCall.data.dueDate, null);
});

test("createTask: omitted optional fields are passed through as undefined, never invented", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, { title: "Task", status: "TODO", priority: "MEDIUM" });

  const lastCall = createCalls[createCalls.length - 1];
  assert.equal(lastCall.data.description, undefined);
  assert.equal(lastCall.data.assigneeId, undefined);
  assert.equal(lastCall.data.dueDate, undefined);
});

test("createTask: an assigneeId that is a project member is accepted", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  const before = createCalls.length;

  const result = await createTask(REAL_USER_ID, REAL_PROJECT_ID, {
    title: "Task",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: MEMBER_ID,
  });

  assert.equal(createCalls.length, before + 1);
  assert.equal(result.assigneeId, MEMBER_ID);
});

test("createTask: an assigneeId who is the project owner (no ProjectMember row) is accepted", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  const before = createCalls.length;

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, {
    title: "Task",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: OWNER_ID,
  });

  assert.equal(createCalls.length, before + 1);
});

test("createTask: an assigneeId that is not a member of the project is rejected, and create is never attempted", async () => {
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";
  const before = createCalls.length;

  await assert.rejects(
    () =>
      createTask(REAL_USER_ID, REAL_PROJECT_ID, {
        title: "Task",
        status: "TODO",
        priority: "MEDIUM",
        assigneeId: OUTSIDER_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  assert.equal(createCalls.length, before, "create must never be attempted for an out-of-project assignee");
});

test("createTask: calls getProjectAccess before ever attempting to write", async () => {
  const before = getProjectAccessCalls;
  const { createTask } = await import("./task.service");
  projectAccessRole = "OWNER";

  await createTask(REAL_USER_ID, REAL_PROJECT_ID, { title: "Task", status: "TODO", priority: "MEDIUM" });

  assert.ok(getProjectAccessCalls > before, "getProjectAccess must be called");
});
