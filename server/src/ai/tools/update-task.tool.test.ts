import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_TASK_ID = "task-1";
const REAL_USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";
const OUTSIDER_ID = "outsider-1";

// "./update-task.tool" is only ever evaluated once per resolved specifier -
// a later t.mock.module call does not retroactively change the bindings a
// module already captured on its first import (same module-cache
// constraint documented throughout this suite, e.g.
// create-task.tool.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshTool() {
  return import(`./update-task.tool?test=${importCounter++}`) as Promise<typeof import("./update-task.tool")>;
}

function baseTaskRow() {
  return {
    id: REAL_TASK_ID,
    projectId: REAL_PROJECT_ID,
    title: "Original title",
    description: "Original description",
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    assigneeId: null as string | null,
    createdById: OWNER_ID,
    dueDate: null as Date | null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

interface MockOptions {
  role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  taskRow?: ReturnType<typeof baseTaskRow>;
  validAssigneeIds?: string[];
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const role = options.role ?? "OWNER";
  const taskRow = options.taskRow ?? baseTaskRow();
  const pendingActionCreateCalls: unknown[] = [];
  let taskUpdateCalled = false;

  t.mock.module("../../services/project.service", {
    namedExports: {
      assertRole: (callerRole: string, allowed: string[]) => {
        if (!allowed.includes(callerRole)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("../../services/task.service", {
    namedExports: {
      getTaskAccess: async (taskId: string) => {
        if (taskId !== taskRow.id) {
          throw new AppError(404, "Task not found");
        }
        return { task: taskRow, projectId: taskRow.projectId, role };
      },
      assertAssigneeIsProjectMember: async (_projectId: string, assigneeId: string) => {
        if (!(options.validAssigneeIds ?? []).includes(assigneeId)) {
          throw new AppError(400, "assigneeId must be a member of this project");
        }
      },
      // A poison pill: if the tool ever calls the real updateTask (which
      // would write a Task), this makes that failure loud and immediate
      // rather than silently succeeding - the tool must NEVER import or
      // call this.
      updateTask: async () => {
        taskUpdateCalled = true;
        throw new Error("update-task.tool.ts must never call task.service.updateTask directly");
      },
    },
  });

  t.mock.module("../../services/pending-task-action.service", {
    namedExports: {
      createPendingTaskAction: async (args: unknown) => {
        pendingActionCreateCalls.push(args);
        return {
          id: "action-1",
          ...(args as object),
          status: "PENDING",
          resultTaskId: null,
          resultError: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-01T00:15:00.000Z"),
          confirmedAt: null,
        };
      },
    },
  });

  return {
    wasTaskUpdateCalled: () => taskUpdateCalled,
    pendingActionCreateCalls: () => pendingActionCreateCalls,
  };
}

// Invokes the tool exactly the way tool-loop.ts's executeToolCall really
// does: parse the raw args against the tool's own schema first, then call
// the handler with the parsed result.
async function invoke(
  tool: Awaited<ReturnType<typeof importFreshTool>>["updateTaskTool"],
  rawArgs: unknown,
  ctx: { userId: string; projectId: string; conversationId?: string },
) {
  return tool.handler(tool.schema.parse(rawArgs), ctx);
}

// --- Role-based authorization ------------------------------------------

for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
  test(`updateTask: ${role} can propose an update; a PendingTaskAction is created with the correct fields`, async (t) => {
    const spies = mockModules(t, { role });
    const { updateTaskTool } = await importFreshTool();

    const result = (await invoke(
      updateTaskTool,
      { taskId: REAL_TASK_ID, status: "DONE" },
      { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
    )) as { result: { status: string; actionId: string; summary: string } };

    const calls = spies.pendingActionCreateCalls();
    assert.equal(calls.length, 1, `role ${role} should create exactly one PendingTaskAction`);

    assert.equal(result.result.status, "pending_confirmation");
    assert.equal(result.result.actionId, "action-1");
    assert.match(result.result.summary, /Original title/);
  });
}

test("updateTask: VIEWER cannot propose an update, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "VIEWER" });
  const { updateTaskTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(updateTaskTool, { taskId: REAL_TASK_ID, status: "DONE" }, {
        userId: REAL_USER_ID,
        projectId: REAL_PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- Invalid assignee ----------------------------------------------------

test("updateTask: an assigneeId that is not a project member is rejected, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "OWNER", validAssigneeIds: [] });
  const { updateTaskTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(updateTaskTool, { taskId: REAL_TASK_ID, assigneeId: OUTSIDER_ID }, {
        userId: REAL_USER_ID,
        projectId: REAL_PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

test("updateTask: a valid assigneeId is accepted", async (t) => {
  const spies = mockModules(t, { role: "OWNER", validAssigneeIds: [MEMBER_ID] });
  const { updateTaskTool } = await importFreshTool();

  await invoke(updateTaskTool, { taskId: REAL_TASK_ID, assigneeId: MEMBER_ID }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(spies.pendingActionCreateCalls().length, 1);
});

test("updateTask: explicit null assigneeId (unassign) never triggers the membership check", async (t) => {
  const spies = mockModules(t, { role: "OWNER", validAssigneeIds: [] });
  const { updateTaskTool } = await importFreshTool();

  await invoke(updateTaskTool, { taskId: REAL_TASK_ID, assigneeId: null }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(spies.pendingActionCreateCalls().length, 1);
});

// --- Persisted proposal shape ---------------------------------------------

test("updateTask: the persisted action has actionType UPDATE_TASK, the target taskId, changes limited to supplied fields, and a snapshot of the original values", async (t) => {
  const taskRow = { ...baseTaskRow(), assigneeId: null };
  const spies = mockModules(t, { role: "OWNER", taskRow, validAssigneeIds: [MEMBER_ID] });
  const { updateTaskTool } = await importFreshTool();

  await invoke(
    updateTaskTool,
    { taskId: REAL_TASK_ID, status: "DONE", assigneeId: MEMBER_ID },
    { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
  );

  const call = spies.pendingActionCreateCalls()[0] as {
    conversationId: string;
    projectId: string;
    userId: string;
    actionType: string;
    taskId: string;
    proposedInput: {
      changes: Record<string, unknown>;
      snapshot: Record<string, unknown>;
    };
  };

  assert.equal(call.conversationId, CONVERSATION_ID);
  assert.equal(call.projectId, REAL_PROJECT_ID);
  assert.equal(call.userId, REAL_USER_ID);
  assert.equal(call.actionType, "UPDATE_TASK");
  assert.equal(call.taskId, REAL_TASK_ID);

  // Only the two fields actually supplied - never title/description/
  // priority/dueDate, which were never mentioned.
  assert.deepEqual(Object.keys(call.proposedInput.changes).sort(), ["assigneeId", "status"]);
  assert.equal(call.proposedInput.changes.status, "DONE");
  assert.equal(call.proposedInput.changes.assigneeId, MEMBER_ID);

  // Snapshot reflects the task's values BEFORE this proposal, exactly as
  // returned by getTaskAccess - never the proposed values.
  assert.deepEqual(call.proposedInput.snapshot, {
    title: "Original title",
    description: "Original description",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    dueDate: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
});

test("updateTask: description/assigneeId/dueDate explicit null are preserved in changes, not dropped", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  await invoke(
    updateTaskTool,
    { taskId: REAL_TASK_ID, description: null, assigneeId: null, dueDate: null },
    { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
  );

  const call = spies.pendingActionCreateCalls()[0] as {
    proposedInput: { changes: Record<string, unknown> };
  };
  assert.equal(call.proposedInput.changes.description, null);
  assert.equal(call.proposedInput.changes.assigneeId, null);
  assert.equal(call.proposedInput.changes.dueDate, null);
});

test("updateTask: fields never mentioned by the model are absent from changes entirely (not undefined-valued, not present)", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  await invoke(updateTaskTool, { taskId: REAL_TASK_ID, title: "New title" }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  const call = spies.pendingActionCreateCalls()[0] as {
    proposedInput: { changes: Record<string, unknown> };
  };
  assert.deepEqual(Object.keys(call.proposedInput.changes), ["title"]);
});

// --- No-op rejection -------------------------------------------------------

test("updateTask: a no-op update (only taskId) is rejected before the schema's own .refine(), and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  assert.throws(() => updateTaskTool.schema.parse({ taskId: REAL_TASK_ID }));
  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- Never mutates the task --------------------------------------------

test("updateTask: never calls task.service.updateTask - only a PendingTaskAction is ever created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  await invoke(updateTaskTool, { taskId: REAL_TASK_ID, title: "Renamed" }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(spies.wasTaskUpdateCalled(), false);
  assert.equal(spies.pendingActionCreateCalls().length, 1);
});

// --- Model-facing result -----------------------------------------------

test("updateTask: the model-facing result says the update is pending/proposed, never that it already happened", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  const result = (await invoke(updateTaskTool, { taskId: REAL_TASK_ID, title: "Renamed" }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: { status: string; summary: string } };

  assert.equal(result.result.status, "pending_confirmation");
  assert.match(result.result.summary, /awaiting your confirmation/i);
  assert.doesNotMatch(result.result.summary, /updated successfully/i);
});

test("security: a missing conversationId in ToolContext fails safely rather than creating an orphaned action", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { updateTaskTool } = await importFreshTool();

  await assert.rejects(() =>
    invoke(updateTaskTool, { taskId: REAL_TASK_ID, title: "Renamed" }, {
      userId: REAL_USER_ID,
      projectId: REAL_PROJECT_ID,
    }),
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});
