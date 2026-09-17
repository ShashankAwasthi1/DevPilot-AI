import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";
import type { TaskDto } from "./task.service";

const ACTION_ID = "action-1";
const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";
const USER_ID = "user-1";

const BASE_PROPOSED_INPUT = { title: "Add dark mode support", status: "TODO", priority: "MEDIUM" };

function storedAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    proposedInput: BASE_PROPOSED_INPUT,
    status: "PENDING",
    resultTaskId: null,
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
// module-cache constraint documented throughout this test suite, e.g.
// project-member.service.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./pending-task-action.service?test=${importCounter++}`) as Promise<
    typeof import("./pending-task-action.service")
  >;
}

interface MockOptions {
  action?: ReturnType<typeof storedAction>;
  createTask?: (...args: unknown[]) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
  update?: (args: unknown) => Promise<unknown>;
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const action = options.action ?? storedAction();
  const updateCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const createTaskCalls: unknown[] = [];

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          // Real prisma.findFirst semantics: only returns a row when every
          // WHERE predicate matches - this is what actually exercises the
          // four-key ownership guarantee (actionId + projectId +
          // conversationId + userId), not just a stub that always returns
          // the row regardless of what was asked for.
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

  const defaultCreateTask = async (...args: unknown[]) => ({
    id: "task-1",
    projectId: args[1],
    title: (args[2] as { title: string }).title,
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    createdById: args[0],
    dueDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  t.mock.module("./task.service", {
    namedExports: {
      // Always records the call (regardless of a custom createTask
      // override) before delegating - so tests asserting "createTask was
      // attempted" work identically whether that attempt succeeds or
      // throws.
      createTask: async (...args: unknown[]) => {
        createTaskCalls.push(args);
        return (options.createTask ?? defaultCreateTask)(...args);
      },
    },
  });

  return {
    updateCalls: () => updateCalls,
    updateManyCalls: () => updateManyCalls,
    createTaskCalls: () => createTaskCalls,
  };
}

test("confirmPendingTaskAction: success creates exactly one Task, sets CONFIRMED/confirmedAt/resultTaskId, and forwards the exact proposedInput", async (t) => {
  const spies = mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  const task = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto;

  assert.equal(spies.createTaskCalls().length, 1);
  assert.deepEqual(spies.createTaskCalls()[0], [USER_ID, PROJECT_ID, BASE_PROPOSED_INPUT]);

  const claim = spies.updateManyCalls()[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
  assert.equal(claim.where.id, ACTION_ID);
  assert.equal(claim.where.status, "PENDING");
  assert.equal(claim.data.status, "CONFIRMED");
  assert.ok(claim.data.confirmedAt instanceof Date);

  const resultUpdate = spies.updateCalls()[0] as { data: Record<string, unknown> };
  assert.equal(resultUpdate.data.resultTaskId, "task-1");

  assert.equal(task.id, "task-1");
  assert.equal(task.title, "Add dark mode support");
});

test("confirmPendingTaskAction: wrong user is rejected with 404, and no claim/create is ever attempted", async (t) => {
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
  assert.equal(spies.createTaskCalls().length, 0);
});

test("confirmPendingTaskAction: wrong project is rejected with 404", async (t) => {
  mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, "someone-elses-project", CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("confirmPendingTaskAction: wrong conversation is rejected with 404", async (t) => {
  mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, "someone-elses-conversation", USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("confirmPendingTaskAction: an unknown actionId is rejected with 404", async (t) => {
  mockModules(t);
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction("not-a-real-action", PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("confirmPendingTaskAction: an already-CONFIRMED action is rejected with 409, and no second Task is created", async (t) => {
  const spies = mockModules(t, { action: storedAction({ status: "CONFIRMED", resultTaskId: "task-existing" }) });
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

  assert.equal(spies.createTaskCalls().length, 0);
});

test("confirmPendingTaskAction: a CANCELLED action is rejected with 409", async (t) => {
  mockModules(t, { action: storedAction({ status: "CANCELLED" }) });
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

test("confirmPendingTaskAction: an expired action is rejected with 409 and the distinct expired message", async (t) => {
  mockModules(t, { action: storedAction({ expiresAt: new Date(Date.now() - 1000) }) });
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
});

test("confirmPendingTaskAction: an atomic claim that affects 0 rows (lost race) is rejected with 409, and Task creation is never attempted", async (t) => {
  const spies = mockModules(t, { updateMany: async () => ({ count: 0 }) });
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

  assert.equal(spies.createTaskCalls().length, 0);
});

test("confirmPendingTaskAction: a task-creation authorization failure leaves the action CONFIRMED (not reverted), stores a safe resultError, and propagates the original error", async (t) => {
  const spies = mockModules(t, {
    createTask: async () => {
      throw new AppError(403, "You do not have permission to perform this action");
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  // The claim already succeeded (this is what "stays CONFIRMED" means) -
  // no second updateMany call ever reverts it back to PENDING.
  assert.equal(spies.updateManyCalls().length, 1);
  const resultUpdate = spies.updateCalls()[0] as { data: Record<string, unknown> };
  assert.equal(resultUpdate.data.resultError, "You do not have permission to perform this action");
});

test("confirmPendingTaskAction: an assignee removed before confirmation leaves the action CONFIRMED with resultError, and no Task is created", async (t) => {
  const spies = mockModules(t, {
    createTask: async () => {
      throw new AppError(400, "assigneeId must be a member of this project");
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  await assert.rejects(() => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID));

  assert.equal(spies.createTaskCalls().length, 1, "createTask was attempted, but it threw and produced no task");
  const resultUpdate = spies.updateCalls()[0] as { data: Record<string, unknown> };
  assert.equal(resultUpdate.data.resultError, "assigneeId must be a member of this project");
});

test("confirmPendingTaskAction: extra fields inside proposedInput (projectId/userId/createdById) never reach createTask - projectId/userId always come from the row's own columns", async (t) => {
  const maliciousAction = storedAction({
    proposedInput: {
      ...BASE_PROPOSED_INPUT,
      projectId: "attacker-project",
      userId: "attacker-user",
      createdById: "attacker-user",
    },
  });
  const spies = mockModules(t, { action: maliciousAction });
  const { confirmPendingTaskAction } = await importFreshService();

  await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  const call = spies.createTaskCalls()[0] as [string, string, Record<string, unknown>];
  assert.equal(call[0], USER_ID, "userId argument always comes from the row, never proposedInput");
  assert.equal(call[1], PROJECT_ID, "projectId argument always comes from the row, never proposedInput");
  // createTaskSchema silently strips unknown keys - none of the injected
  // fields survive into the object actually passed to createTask.
  assert.deepEqual(Object.keys(call[2]).sort(), ["priority", "status", "title"]);
});

test("confirmPendingTaskAction: repeated confirmation of the same action cannot create a second Task", async (t) => {
  let claimUsed = false;
  const spies = mockModules(t, {
    updateMany: async () => {
      if (claimUsed) return { count: 0 };
      claimUsed = true;
      return { count: 1 };
    },
  });
  const { confirmPendingTaskAction } = await importFreshService();

  const first = (await confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID)) as TaskDto;
  assert.equal(first.id, "task-1");

  await assert.rejects(
    () => confirmPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  assert.equal(spies.createTaskCalls().length, 1, "createTask must only ever be called once across both attempts");
});
