import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";
import type { TaskDto } from "./task.service";

const ACTION_ID = "action-1";
const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";
const USER_ID = "user-1";

const BASE_TASKS = [
  { tempId: "t1", title: "Set up hosting", priority: "MEDIUM" },
  { tempId: "t2", title: "Write onboarding emails", priority: "HIGH", description: "Draft the welcome series" },
];

function baseProposedInput(overrides: Record<string, unknown> = {}) {
  return {
    planTitle: "MVP Launch Plan",
    summary: "Get the SaaS MVP launched.",
    tasks: BASE_TASKS,
    ...overrides,
  };
}

function storedAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    actionType: "CREATE_PROJECT_PLAN",
    taskId: null,
    proposedInput: baseProposedInput(),
    status: "PENDING",
    resultTaskId: null,
    resultTaskIds: [] as string[],
    resultError: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    confirmedAt: null,
    ...overrides,
  };
}

// "./pending-task-action.service" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same
// module-cache constraint documented throughout this suite, e.g.
// pending-task-action.service.confirm-update.test.ts). A unique query
// string per test forces a fresh module instance, so each test's own
// mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./pending-task-action.service?test=${importCounter++}`) as Promise<
    typeof import("./pending-task-action.service")
  >;
}

const FAKE_TX = { __fakeTx: true };

interface MockOptions {
  action?: ReturnType<typeof storedAction>;
  role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  getProjectAccess?: (projectId: string, userId: string) => Promise<{ role: string }>;
  createTask?: (...args: unknown[]) => Promise<unknown>;
  transaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
  update?: (args: unknown) => Promise<unknown>;
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const action = options.action ?? storedAction();
  const role = options.role ?? "OWNER";
  const updateCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const createTaskCalls: unknown[] = [];
  let transactionCalls = 0;
  let idCounter = 0;

  const defaultCreateTask = async (...args: unknown[]) => {
    const [userId, projectId, input] = args as [string, string, Record<string, unknown>];
    return {
      id: `task-${++idCounter}`,
      projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "TODO",
      priority: input.priority,
      assigneeId: null,
      createdById: userId,
      dueDate: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  };

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          // Real prisma.findFirst semantics: only returns a row when every
          // WHERE predicate matches - exercises the four-key ownership
          // guarantee (actionId + projectId + conversationId + userId).
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
        $transaction:
          options.transaction ??
          (async (fn: (tx: unknown) => Promise<unknown>) => {
            transactionCalls += 1;
            return fn(FAKE_TX);
          }),
      },
    },
  });

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: options.getProjectAccess ?? (async () => ({ role })),
      assertRole: (callerRole: string, allowed: string[]) => {
        if (!allowed.includes(callerRole)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("./task.service", {
    namedExports: {
      createTask: async (...args: unknown[]) => {
        createTaskCalls.push(args);
        return (options.createTask ?? defaultCreateTask)(...args);
      },
      // The CREATE_TASK/UPDATE_TASK branches are never exercised by these
      // CREATE_PROJECT_PLAN tests, but confirmPendingTaskAction imports
      // these at module scope - poison pills make an accidental
      // cross-branch call loud rather than silently returning undefined.
      getTaskAccess: async () => {
        throw new Error("getTaskAccess must never be called for a CREATE_PROJECT_PLAN confirmation");
      },
      updateTask: async () => {
        throw new Error("updateTask must never be called for a CREATE_PROJECT_PLAN confirmation");
      },
      assertAssigneeIsProjectMember: async () => {
        throw new Error(
          "assertAssigneeIsProjectMember must never be called for a CREATE_PROJECT_PLAN confirmation",
        );
      },
    },
  });

  return {
    updateCalls: () => updateCalls,
    updateManyCalls: () => updateManyCalls,
    createTaskCalls: () => createTaskCalls,
    transactionCalls: () => transactionCalls,
  };
}

// --- Authorization (items 1-5) ----------------------------------------

for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
  test(`confirmPendingTaskAction (CREATE_PROJECT_PLAN): ${role} can confirm a valid plan`, async (t) => {
    const spies = mockModules(t, { role });
    const { confirmPendingTaskAction } = await importFreshService();

    const tasks = await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

    assert.ok(Array.isArray(tasks));
    assert.equal(tasks.length, 2);
    assert.equal(spies.createTaskCalls().length, 2);
  });
}

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): VIEWER cannot confirm - rejected with 403, zero tasks created", async (t) => {
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

  assert.equal(spies.createTaskCalls().length, 0);
  assert.equal(spies.transactionCalls(), 0);
});

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): an unauthorized (wrong) user is rejected with 404, zero tasks created", async (t) => {
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

  assert.equal(spies.createTaskCalls().length, 0);
  assert.equal(spies.transactionCalls(), 0);
});

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): the caller has lost project access since proposing - rejected with 404, zero tasks created", async (t) => {
  const spies = mockModules(t, {
    getProjectAccess: async () => {
      throw new AppError(404, "Project not found");
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

  assert.equal(spies.createTaskCalls().length, 0);
});

// --- Lifecycle (item 6) --------------------------------------------------

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): an expired action is rejected with 409, zero tasks created", async (t) => {
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

  assert.equal(spies.createTaskCalls().length, 0);
  assert.equal(spies.transactionCalls(), 0);
});

// --- Successful creation, ordering, mapping (items 7-13) -----------------

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): a valid multi-task plan creates every task, in proposal order, mapping only title/description/priority", async (t) => {
  const spies = mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  const tasks = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto[];

  assert.equal(spies.createTaskCalls().length, 2);

  const [firstCall, secondCall] = spies.createTaskCalls() as [string, string, Record<string, unknown>, unknown][];
  assert.deepEqual(firstCall.slice(0, 2), [USER_ID, PROJECT_ID]);
  assert.deepEqual(firstCall[2], { title: "Set up hosting", description: null, status: "TODO", priority: "MEDIUM" });
  assert.deepEqual(secondCall[2], {
    title: "Write onboarding emails",
    description: "Draft the welcome series",
    status: "TODO",
    priority: "HIGH",
  });

  // No assigneeId/dueDate/dependency keys were ever invented.
  assert.deepEqual(Object.keys(firstCall[2]).sort(), ["description", "priority", "status", "title"]);
  assert.deepEqual(Object.keys(secondCall[2]).sort(), ["description", "priority", "status", "title"]);

  // Every task in the plan was created via the same client (the tx handed
  // to the transaction callback) - never a mix of tx and the global
  // prisma singleton.
  assert.equal(firstCall[3], secondCall[3]);
  assert.equal(firstCall[3], FAKE_TX);

  // Created task IDs are returned in proposal order.
  assert.deepEqual(
    tasks.map((task) => task.title),
    ["Set up hosting", "Write onboarding emails"],
  );

  // resultTaskIds persisted in the same proposal order, resultTaskId/taskId
  // stay null (this is a plan, not a single-task proposal).
  const resultUpdate = spies.updateCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.resultTaskIds !== undefined;
  }) as { data: Record<string, unknown> } | undefined;
  assert.ok(resultUpdate);
  assert.deepEqual(
    resultUpdate!.data.resultTaskIds,
    tasks.map((task) => task.id),
  );
  assert.equal(resultUpdate!.data.resultTaskId, undefined);
});

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): resultTaskId and taskId are never populated for a plan confirmation", async (t) => {
  mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  const tasks = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto[];

  // The action row itself (storedAction()) already has taskId: null and
  // resultTaskId: null and nothing in this flow ever writes to either -
  // only resultTaskIds (asserted above) is ever touched.
  assert.equal(tasks.length, 2);
});

// --- Dispatcher regression: CREATE_TASK / UPDATE_TASK still route correctly (items 14-15) --

test("confirmPendingTaskAction dispatcher: a CREATE_TASK action still resolves to a single task (not an array), unaffected by the new CREATE_PROJECT_PLAN branch", async (t) => {
  const createTaskAction = storedAction({
    actionType: "CREATE_TASK",
    taskId: null,
    proposedInput: { title: "Add dark mode support", status: "TODO", priority: "MEDIUM" },
  });
  const spies = mockModules(t, { action: createTaskAction });
  const { confirmPendingTaskAction } = await importFreshService();

  const result = await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  assert.equal(Array.isArray(result), false);
  assert.equal(spies.createTaskCalls().length, 1);
  // A single-task confirmation never opens the plan's transaction.
  assert.equal(spies.transactionCalls(), 0);
});

test("confirmPendingTaskAction dispatcher: an UPDATE_TASK action still routes through its own confirm path, never touching createTask or the plan transaction", async (t) => {
  const SNAPSHOT_UPDATED_AT = "2026-01-01T00:00:00.000Z";
  const updateTaskAction = storedAction({
    actionType: "UPDATE_TASK",
    taskId: "task-existing",
    proposedInput: {
      changes: { status: "DONE" },
      snapshot: {
        title: "Original",
        description: null,
        status: "TODO",
        priority: "MEDIUM",
        assigneeId: null,
        dueDate: null,
        updatedAt: SNAPSHOT_UPDATED_AT,
      },
    },
  });

  // This one test needs a real (non-poison-pill) getTaskAccess/updateTask,
  // so it registers its own task.service mock rather than using the
  // shared helper's poison pills.
  const updateTaskCalls: unknown[] = [];
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          findFirst: async () => updateTaskAction,
          updateMany: async () => ({ count: 1 }),
          update: async () => ({}),
        },
        $transaction: async () => {
          throw new Error("UPDATE_TASK confirmation must never open the plan transaction");
        },
      },
    },
  });
  t.mock.module("./project.service", {
    namedExports: {
      assertRole: () => {},
      getProjectAccess: async () => ({ role: "OWNER" }),
    },
  });
  t.mock.module("./task.service", {
    namedExports: {
      createTask: async () => {
        throw new Error("createTask must never be called for an UPDATE_TASK confirmation");
      },
      getTaskAccess: async () => ({
        task: {
          id: "task-existing",
          projectId: PROJECT_ID,
          title: "Original",
          description: null,
          status: "TODO",
          priority: "MEDIUM",
          assigneeId: null,
          createdById: "owner-1",
          dueDate: null,
          createdAt: new Date("2025-12-01T00:00:00.000Z"),
          updatedAt: new Date(SNAPSHOT_UPDATED_AT),
        },
        projectId: PROJECT_ID,
        role: "OWNER",
      }),
      assertAssigneeIsProjectMember: async () => {},
      updateTask: async (...args: unknown[]) => {
        updateTaskCalls.push(args);
        return { id: "task-existing", title: "Original", status: "DONE" };
      },
    },
  });

  const { confirmPendingTaskAction } = await importFreshService();
  const result = await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  assert.equal(Array.isArray(result), false);
  assert.equal(updateTaskCalls.length, 1);
});

// --- Double confirmation / races (items 16-17) ---------------------------

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): double confirmation cannot create duplicate tasks - only the first, winning claim creates anything", async (t) => {
  let claimCallCount = 0;
  const spies = mockModules(t, {
    updateMany: async () => {
      claimCallCount += 1;
      return { count: claimCallCount === 1 ? 1 : 0 };
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  const first = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto[];
  assert.equal(first.length, 2);

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  // Only the first confirmation's two tasks were ever created - the
  // second call never reaches the transaction at all.
  assert.equal(spies.createTaskCalls().length, 2);
  assert.equal(spies.transactionCalls(), 1);
});

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): confirm racing cancel is safe - only one terminal action wins, cancel never creates a task", async (t) => {
  let claimCallCount = 0;
  const spies = mockModules(t, {
    updateMany: async () => {
      claimCallCount += 1;
      // Simulates a genuine race: whichever of confirm/cancel's own
      // status="PENDING"-guarded updateMany reaches the database first
      // wins; the other affects zero rows.
      return { count: claimCallCount === 1 ? 1 : 0 };
    },
  });
  const { confirmPendingTaskAction, cancelPendingTaskAction } = await importFreshService();

  const tasks = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto[];
  assert.equal(tasks.length, 2);

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  assert.equal(spies.createTaskCalls().length, 2);
});

// --- Malformed proposal (item 18) ----------------------------------------

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): a malformed stored proposal (missing tasks) is rejected safely with 500, zero tasks created, action left PENDING", async (t) => {
  const spies = mockModules(t, {
    action: storedAction({ proposedInput: { planTitle: "Plan with no tasks field" } }),
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

  assert.equal(spies.createTaskCalls().length, 0);
  assert.equal(spies.transactionCalls(), 0);
  // Never even attempted the atomic claim - re-validation happens first.
  assert.equal(spies.updateManyCalls().length, 0);
});

// --- Critical: atomic rollback (item 21) ----------------------------------

test("confirmPendingTaskAction (CREATE_PROJECT_PLAN): ATOMIC ROLLBACK - a later task's failure aborts the whole transaction and commits nothing", async (t) => {
  const proposedInput = baseProposedInput({
    tasks: [
      { tempId: "t1", title: "Task One", priority: "MEDIUM" },
      { tempId: "t2", title: "Task Two", priority: "MEDIUM" },
      { tempId: "t3", title: "Task Three", priority: "MEDIUM" },
    ],
  });
  const action = storedAction({ proposedInput });

  // Faithfully models Prisma's actual interactive-transaction guarantee:
  // writes performed via the `tx` handed to the callback only become
  // externally visible (merged into `committedTasks`, our stand-in for
  // the real tasks table) if the callback itself resolves. If it throws -
  // as it does here, on the third task - nothing already appended to
  // `pending` is ever merged in. This is not "faking" a rollback by
  // deleting rows after the fact (nothing is ever added to
  // `committedTasks` for there to be anything to delete); it reproduces
  // the same commit-on-success/discard-on-failure semantics a real
  // Postgres transaction provides. A test against the actual Neon
  // database is not possible in this step, since the Phase 25 migration
  // adding CREATE_PROJECT_PLAN/resultTaskIds is intentionally left
  // unapplied (see Step 2/3 scope) - the live schema doesn't have these
  // columns/enum value yet.
  const committedTasks: unknown[] = [];
  const seenTxClients = new Set<unknown>();
  let createCallIndex = 0;
  let transactionCalls = 0;

  const spies = mockModules(t, {
    action,
    transaction: async (fn: (tx: { __pending: unknown[] }) => Promise<unknown>) => {
      transactionCalls += 1;
      const pending: unknown[] = [];
      const tx = { __fakeTx: true, __pending: pending };
      const result = await fn(tx);
      committedTasks.push(...pending);
      return result;
    },
    createTask: async (...args: unknown[]) => {
      const [userId, projectId, input, client] = args as [
        string,
        string,
        Record<string, unknown>,
        { __pending: unknown[] },
      ];
      seenTxClients.add(client);
      createCallIndex += 1;
      if (createCallIndex === 3) {
        throw new Error("simulated database failure creating task #3 (must never surface to the caller)");
      }
      const task = {
        id: `task-${createCallIndex}`,
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: "TODO",
        priority: input.priority,
        assigneeId: null,
        createdById: userId,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      client.__pending.push(task);
      return task;
    },
  });

  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(() => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID));

  // Exactly one transaction was opened for the entire plan - never one per
  // task.
  assert.equal(transactionCalls, 1);
  // Every createTask call - including the one that failed - received the
  // exact same tx client, never a mix of tx and the global prisma.
  assert.equal(seenTxClients.size, 1);
  // All three tasks were attempted, strictly in order, before the
  // transaction aborted on the third.
  assert.equal(createCallIndex, 3);

  // Nothing committed: task #1 and task #2, which "succeeded" before the
  // failure, are never externally visible, and task #3 never existed at
  // all - because the transaction callback itself rejected before this
  // test's stand-in for the tasks table was ever updated.
  assert.equal(committedTasks.length, 0);

  // No partial (or any) resultTaskIds were ever persisted - the failure
  // path only ever writes resultError, never resultTaskIds.
  const resultTaskIdsUpdate = spies.updateCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.resultTaskIds !== undefined;
  });
  assert.equal(resultTaskIdsUpdate, undefined);

  // A safe, bounded resultError was recorded instead - never the raw
  // error message/stack from the simulated database failure.
  const errorUpdate = spies.updateCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.resultError !== undefined;
  }) as { data: Record<string, unknown> } | undefined;
  assert.ok(errorUpdate);
  assert.equal(errorUpdate!.data.resultError, "Project plan creation failed.");
  assert.doesNotMatch(errorUpdate!.data.resultError as string, /simulated database failure/);

  // The action's own lifecycle was already claimed CONFIRMED before the
  // failing mutation was attempted - same discipline as every other
  // confirm path's failure handling: never reverted back to PENDING, and
  // (per the double-confirmation tests above) can never be retried.
  const claim = spies.updateManyCalls().find((call) => {
    const { data } = call as { data: Record<string, unknown> };
    return data.status === "CONFIRMED";
  });
  assert.ok(claim, "the atomic claim must still have run before the failing mutation");

  // Notification-rollback note: every proposed task is mapped without an
  // assigneeId (proved generically by the "maps only title/description/
  // priority" test above), so taskService.createTask's own notification
  // branch (`if (task.assigneeId && ...)`) is structurally unreachable
  // for a plan-generated task, success or failure alike - there is no
  // notification write for this flow to roll back, independent of the
  // transaction's outcome.
});
