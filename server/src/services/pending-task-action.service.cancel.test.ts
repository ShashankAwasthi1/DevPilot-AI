import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

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

// See pending-task-action.service.confirm.test.ts's identical comment -
// same module-cache constraint, same cache-busting fix.
let importCounter = 0;
function importFreshService() {
  return import(`./pending-task-action.service?test=${importCounter++}`) as Promise<
    typeof import("./pending-task-action.service")
  >;
}

interface MockOptions {
  action?: ReturnType<typeof storedAction>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const action = options.action ?? storedAction();
  const updateManyCalls: unknown[] = [];
  let taskCreateCalled = false;

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
          update: async () => ({}),
        },
      },
    },
  });

  // Cancellation must never touch task creation at all - this mock exists
  // purely so a test can assert it was never called.
  t.mock.module("./task.service", {
    namedExports: {
      createTask: async () => {
        taskCreateCalled = true;
        throw new Error("cancelPendingTaskAction must never call task.service.createTask");
      },
    },
  });

  return {
    updateManyCalls: () => updateManyCalls,
    wasTaskCreateCalled: () => taskCreateCalled,
  };
}

test("cancelPendingTaskAction: success transitions to CANCELLED, and no Task is ever created", async (t) => {
  const spies = mockModules(t);
  const { cancelPendingTaskAction } = await importFreshService();

  const result = await cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);

  assert.deepEqual(result, { actionId: ACTION_ID, status: "CANCELLED" });
  const claim = spies.updateManyCalls()[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
  assert.equal(claim.where.id, ACTION_ID);
  assert.equal(claim.where.status, "PENDING");
  assert.equal(claim.data.status, "CANCELLED");
  assert.equal(spies.wasTaskCreateCalled(), false);
});

test("cancelPendingTaskAction: wrong user/project/conversation are all rejected with 404", async (t) => {
  mockModules(t);
  const { cancelPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, "someone-else"),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, "someone-elses-project", CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, "someone-elses-conversation", USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("cancelPendingTaskAction: an already-CONFIRMED action is rejected with 409", async (t) => {
  mockModules(t, { action: storedAction({ status: "CONFIRMED", resultTaskId: "task-1" }) });
  const { cancelPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal is no longer pending");
      return true;
    },
  );
});

test("cancelPendingTaskAction: an already-CANCELLED action is rejected with 409", async (t) => {
  mockModules(t, { action: storedAction({ status: "CANCELLED" }) });
  const { cancelPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal is no longer pending");
      return true;
    },
  );
});

test("cancelPendingTaskAction: an expired action is rejected with 409 and the distinct expired message", async (t) => {
  mockModules(t, { action: storedAction({ expiresAt: new Date(Date.now() - 1000) }) });
  const { cancelPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "This proposal has expired");
      return true;
    },
  );
});

test("cancelPendingTaskAction: concurrent/repeated cancellation cannot produce inconsistent state - only the first attempt succeeds", async (t) => {
  let claimUsed = false;
  const spies = mockModules(t, {
    updateMany: async () => {
      if (claimUsed) return { count: 0 };
      claimUsed = true;
      return { count: 1 };
    },
  });
  const { cancelPendingTaskAction } = await importFreshService();

  const first = await cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID);
  assert.deepEqual(first, { actionId: ACTION_ID, status: "CANCELLED" });

  await assert.rejects(
    () => cancelPendingTaskAction(ACTION_ID, PROJECT_ID, CONVERSATION_ID, USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );

  assert.equal(spies.wasTaskCreateCalled(), false);
});
