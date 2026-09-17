import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";
import type { TaskDto } from "./task.service";

const ACTION_ID = "action-1";
const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";
const USER_ID = "user-1";
const TASK_ID = "task-1";
const SNAPSHOT_UPDATED_AT = "2026-01-01T00:00:00.000Z";

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: "Original title",
    description: "Original description",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    dueDate: null,
    updatedAt: SNAPSHOT_UPDATED_AT,
    ...overrides,
  };
}

function baseChanges(overrides: Record<string, unknown> = {}) {
  return { status: "DONE", ...overrides };
}

function storedAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    actionType: "UPDATE_TASK",
    taskId: TASK_ID,
    proposedInput: { changes: baseChanges(), snapshot: baseSnapshot() },
    status: "PENDING",
    resultTaskId: null,
    resultError: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    confirmedAt: null,
    ...overrides,
  };
}

// The "live" task row getTaskAccess returns at confirm time - defaults to
// matching baseSnapshot()'s updatedAt exactly (not stale).
function currentTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    title: "Original title",
    description: "Original description",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    createdById: "owner-1",
    dueDate: null,
    createdAt: new Date("2025-12-01T00:00:00.000Z"),
    updatedAt: new Date(SNAPSHOT_UPDATED_AT),
    ...overrides,
  };
}

// "./pending-task-action.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same
// module-cache constraint documented throughout this suite, e.g.
// pending-task-action.service.confirm.test.ts). A unique query string per
// test forces a fresh module instance, so each test's own mocks actually
// take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./pending-task-action.service?test=${importCounter++}`) as Promise<
    typeof import("./pending-task-action.service")
  >;
}

interface MockOptions {
  action?: ReturnType<typeof storedAction>;
  role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  currentTask?: ReturnType<typeof currentTaskRow>;
  getTaskAccess?: (taskId: string, userId: string) => Promise<unknown>;
  assertAssigneeIsProjectMember?: (projectId: string, assigneeId: string) => Promise<void>;
  updateTask?: (...args: unknown[]) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
  update?: (args: unknown) => Promise<unknown>;
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const action = options.action ?? storedAction();
  const role = options.role ?? "OWNER";
  const currentTask = options.currentTask ?? currentTaskRow();
  const updateCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const updateTaskCalls: unknown[] = [];
  let getTaskAccessCalls = 0;

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            if (
              where.id === action.id &&
              where.projectId === action.projectId &&
              where.conversationId === action.conversationId &&
              where.userId === action.userId
            ) {
              return action;
            }
            return null;
          },
          updateMany:
            options.updateMany ??
            (async (args: unknown) => {
              updateManyCalls.push(args);
              return { count: 1 };
            }),
          update:
            options.update ??
            (async (args: unknown) => {
              updateCalls.push(args);
              return {};
            }),
        },
      },
    },
  });

  t.mock.module("./project.service", {
    namedExports: {
      assertRole: (callerRole: string, allowed: string[]) => {
        if (!allowed.includes(callerRole)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  const defaultUpdateTask = async (..._args: unknown[]) => ({
    id: TASK_ID,
    projectId: PROJECT_ID,
    title: "Original title",
    description: "Original description",
    status: "DONE",
    priority: "MEDIUM",
    assigneeId: null,
    createdById: "owner-1",
    dueDate: null,
    createdAt: new Date("2025-12-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-05T00:00:00.000Z"),
  });

  t.mock.module("./task.service", {
    namedExports: {
      // The CREATE_TASK branch is never exercised by these UPDATE_TASK
      // tests, but confirmPendingTaskAction imports this at module scope -
      // a poison pill makes an accidental cross-branch call loud rather
      // than silently returning undefined.
      createTask: async () => {
        throw new Error("createTask must never be called for an UPDATE_TASK confirmation");
      },
      getTaskAccess:
        options.getTaskAccess ??
        (async (taskId: string) => {
          getTaskAccessCalls += 1;
          if (taskId !== TASK_ID) {
            throw new AppError(404, "Task not found");
          }
          return { task: currentTask, projectId: PROJECT_ID, role };
        }),
      assertAssigneeIsProjectMember:
        options.assertAssigneeIsProjectMember ??
        (async () => {
          /* accepted by default */
        }),
      updateTask: async (...args: unknown[]) => {
        updateTaskCalls.push(args);
        return (options.updateTask ?? defaultUpdateTask)(...args);
      },
    },
  });

  return {
    updateCalls: () => updateCalls,
    updateManyCalls: () => updateManyCalls,
    updateTaskCalls: () => updateTaskCalls,
    getTaskAccessCalls: () => getTaskAccessCalls,
  };
}

// --- Ownership / lifecycle -------------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): success calls taskService.updateTask exactly once and returns its result", async (t) => {
  const spies = mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  const task = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto;

  assert.equal(spies.updateTaskCalls().length, 1);
  assert.equal(task.id, TASK_ID);
  assert.equal(task.status, "DONE");
});

test("confirmPendingTaskAction (UPDATE_TASK): wrong user is rejected with 404, and no claim/update is ever attempted", async (t) => {
  const spies = mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, "someone-else"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(spies.updateManyCalls().length, 0);
  assert.equal(spies.updateTaskCalls().length, 0);
});

test("confirmPendingTaskAction (UPDATE_TASK): an already-CONFIRMED action is rejected with 409, and update is never attempted again", async (t) => {
  const spies = mockModules(t, { action: storedAction({ status: "CONFIRMED", resultTaskId: TASK_ID }) });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal is no longer pending");
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);
});

test("confirmPendingTaskAction (UPDATE_TASK): an expired action is rejected with 409 and the distinct expired message", async (t) => {
  const spies = mockModules(t, { action: storedAction({ expiresAt: new Date(Date.now() - 1000) }) });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal has expired");
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);
});

// --- Authorization re-check --------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): the caller has lost access to the task/project since proposing - rejected with 404, no update attempted", async (t) => {
  const spies = mockModules(t, {
    getTaskAccess: async () => {
      throw new AppError(404, "Task not found");
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);
});

test("confirmPendingTaskAction (UPDATE_TASK): the caller's role has dropped to VIEWER since proposing - rejected with 403, no update attempted", async (t) => {
  const spies = mockModules(t, { role: "VIEWER" });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);
});

test("confirmPendingTaskAction (UPDATE_TASK): the proposed assignee is no longer a project member - rejected with 400, no update attempted", async (t) => {
  const spies = mockModules(t, {
    action: storedAction({
      proposedInput: { changes: baseChanges({ assigneeId: "member-1" }), snapshot: baseSnapshot() },
    }),
    assertAssigneeIsProjectMember: async () => {
      throw new AppError(400, "assigneeId must be a member of this project");
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);
});

// --- Proposal validation --------------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): a malformed proposedInput (missing snapshot) is rejected safely with 500, action left PENDING", async (t) => {
  mockModules(t, {
    action: storedAction({ proposedInput: { changes: baseChanges() } }),
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 500);
      return true;
    },
  );
});

test("confirmPendingTaskAction (UPDATE_TASK): an invalid enum value inside changes is rejected safely with 500", async (t) => {
  mockModules(t, {
    action: storedAction({
      proposedInput: { changes: { status: "NOT_A_REAL_STATUS" }, snapshot: baseSnapshot() },
    }),
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 500);
      return true;
    },
  );
});

// --- Stale protection --------------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): the task changed since the proposal was made - rejected with 409 conflict semantics, update never attempted", async (t) => {
  const spies = mockModules(t, {
    currentTask: currentTaskRow({ updatedAt: new Date("2026-01-02T00:00:00.000Z") }),
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /changed since this proposal was made/);
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 0);

  // The stale detection itself transitions the action to a terminal
  // status via the same atomic, PENDING-guarded updateMany idiom used
  // everywhere else on this model - never left silently re-attemptable.
  const staleTransition = spies.updateManyCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.status === "EXPIRED";
  }) as { where: Record<string, unknown>; data: Record<string, unknown> } | undefined;
  assert.ok(staleTransition, "the stale action must be transitioned via an atomic updateMany");
  assert.equal(staleTransition!.where.status, "PENDING");
});

test("confirmPendingTaskAction (UPDATE_TASK): a stale proposal cannot be retried forever - once EXPIRED, a second confirm attempt gets the generic not-pending message", async (t) => {
  // Simulates the state AFTER the previous test's stale detection has
  // already run: the stored action is now EXPIRED.
  mockModules(t, { action: storedAction({ status: "EXPIRED" }) });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal is no longer pending");
      return true;
    },
  );
});

// --- Mutation: exact changes passed, nothing else -----------------------

test("confirmPendingTaskAction (UPDATE_TASK): taskService.updateTask receives exactly (userId, taskId, changes) - never snapshot/actionType/other persisted fields", async (t) => {
  const changes = { status: "DONE", priority: "URGENT" };
  const spies = mockModules(t, {
    action: storedAction({ proposedInput: { changes, snapshot: baseSnapshot() } }),
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  assert.equal(spies.updateTaskCalls().length, 1);
  const call = spies.updateTaskCalls()[0] as [string, string, Record<string, unknown>];
  assert.equal(call[0], USER_ID);
  assert.equal(call[1], TASK_ID);
  assert.deepEqual(call[2], changes);
  assert.deepEqual(Object.keys(call[2]).sort(), ["priority", "status"]);
});

test("confirmPendingTaskAction (UPDATE_TASK): a successful confirmation records resultTaskId as the target task's id", async (t) => {
  const spies = mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  const task = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto;

  assert.equal(task.id, TASK_ID);
  const resultUpdate = spies.updateCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.resultTaskId !== undefined;
  }) as { data: Record<string, unknown> } | undefined;
  assert.ok(resultUpdate);
  assert.equal(resultUpdate!.data.resultTaskId, TASK_ID);
});

// --- Double confirmation --------------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): two confirmations cannot both mutate the task - the second never calls taskService.updateTask", async (t) => {
  let claimCallCount = 0;
  const spies = mockModules(t, {
    updateMany: async () => {
      claimCallCount += 1;
      // First call wins the claim; every subsequent call loses it -
      // simulates a genuine concurrent/double confirm race.
      return { count: claimCallCount === 1 ? 1 : 0 };
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  assert.equal(spies.updateTaskCalls().length, 1, "only the first, winning confirmation may mutate the task");
});

// --- Failure bookkeeping --------------------------------------------------

test("confirmPendingTaskAction (UPDATE_TASK): a taskService.updateTask failure leaves the action CONFIRMED (not reverted) and stores a safe resultError", async (t) => {
  const spies = mockModules(t, {
    updateTask: async () => {
      throw new AppError(400, "assigneeId must be a member of this project");
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  // The claim already transitioned PENDING -> CONFIRMED before the
  // mutation was attempted - a failure never reverts that.
  const claim = spies.updateManyCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.status === "CONFIRMED";
  });
  assert.ok(claim, "the atomic claim must still have run before the failing mutation");

  const errorUpdate = spies.updateCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.resultError !== undefined;
  }) as { data: Record<string, unknown> } | undefined;
  assert.ok(errorUpdate);
  assert.equal(errorUpdate!.data.resultError, "assigneeId must be a member of this project");
});

// --- Cancel continues to work generically for UPDATE_TASK -----------------

test("cancelPendingTaskAction: works for an UPDATE_TASK action with zero special-casing, and never touches the task", async (t) => {
  const spies = mockModules(t);
  const { cancelPendingTaskAction } = await importFreshService();

  const result = await cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  assert.deepEqual(result, { actionId: ACTION_ID, status: "CANCELLED" });
  assert.equal(spies.updateTaskCalls().length, 0);
});
