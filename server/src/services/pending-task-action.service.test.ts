import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LIMITS } from "../ai/limits";
import { AppError } from "../utils/AppError";

const CONVERSATION_ID = "conversation-1";
const PROJECT_ID = "project-1";
const USER_ID = "user-1";

let importCounter = 0;
function importFreshService() {
  return import(
    `./pending-task-action.service?test=${importCounter++}`
  ) as Promise<typeof import("./pending-task-action.service")>;
}

// Mocks pendingTaskAction.count to actually apply the where-clause filter
// against a fake set of pre-existing rows (rather than returning a canned
// number), so a test can prove the cap only counts PENDING rows for the
// given user - not just that createPendingTaskAction reacts correctly to
// whatever count() happens to return.
function mockPendingActionCap(
  t: import("node:test").TestContext,
  existingActions: { userId: string; status: string }[],
) {
  let createCalled = false;

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          count: async (args: { where: { userId: string; status: string } }) =>
            existingActions.filter(
              (a) => a.userId === args.where.userId && a.status === args.where.status,
            ).length,
          create: async (args: { data: Record<string, unknown> }) => {
            createCalled = true;
            return { id: "action-cap-test", ...args.data };
          },
        },
      },
    },
  });

  return () => createCalled;
}

function proposeArgs(userId: string) {
  return {
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId,
    proposedInput: { title: "Task", status: "TODO" as const, priority: "MEDIUM" as const },
  };
}

test("createPendingTaskAction: persists exactly the given conversationId/projectId/userId/proposedInput, and sets expiresAt ~15 minutes ahead", async (t) => {
  let capturedArgs: { data: Record<string, unknown> } | undefined;

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          count: async () => 0,
          create: async (args: { data: Record<string, unknown> }) => {
            capturedArgs = args;
            return {
              id: "action-1",
              ...args.data,
              status: "PENDING",
              resultTaskId: null,
              resultError: null,
              createdAt: new Date(),
              confirmedAt: null,
            };
          },
        },
      },
    },
  });

  const { createPendingTaskAction } = await import("./pending-task-action.service");

  const proposedInput = { title: "Add dark mode support", status: "TODO" as const, priority: "MEDIUM" as const };
  const before = Date.now();
  const result = await createPendingTaskAction({
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    proposedInput,
  });
  const after = Date.now();

  assert.ok(capturedArgs);
  assert.equal(capturedArgs!.data.conversationId, CONVERSATION_ID);
  assert.equal(capturedArgs!.data.projectId, PROJECT_ID);
  assert.equal(capturedArgs!.data.userId, USER_ID);
  assert.deepEqual(capturedArgs!.data.proposedInput, proposedInput);

  const expiresAt = capturedArgs!.data.expiresAt as Date;
  assert.ok(expiresAt instanceof Date);
  const deltaFromBeforeMs = expiresAt.getTime() - before;
  const deltaFromAfterMs = expiresAt.getTime() - after;
  assert.ok(
    deltaFromBeforeMs >= 15 * 60 * 1000 && deltaFromAfterMs <= 15 * 60 * 1000,
    `expected expiresAt ~15 minutes ahead, got a delta of ${deltaFromBeforeMs}ms (before) / ${deltaFromAfterMs}ms (after)`,
  );

  assert.equal(result.id, "action-1");
});

test("createPendingTaskAction: never touches the tasks table", async (t) => {
  let taskCreateCalled = false;

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
          count: async () => 0,
          create: async (args: { data: Record<string, unknown> }) => ({ id: "action-2", ...args.data }),
        },
        task: {
          create: async () => {
            taskCreateCalled = true;
            throw new Error("pending-task-action.service.ts must never call prisma.task.create");
          },
        },
      },
    },
  });

  const { createPendingTaskAction } = (await import(
    `./pending-task-action.service?test=${Math.random()}`
  )) as typeof import("./pending-task-action.service");

  await createPendingTaskAction({
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    proposedInput: { title: "Task", status: "TODO", priority: "MEDIUM" },
  });

  assert.equal(taskCreateCalled, false);
});

// --- Phase 22 Step 5: per-user open-pending-action cap ----------------------

test("createPendingTaskAction: exactly MAX_OPEN_PENDING_ACTIONS (20) existing PENDING rows for this user blocks the 21st", async (t) => {
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS }, () => ({
    userId: USER_ID,
    status: "PENDING",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await assert.rejects(
    () => createPendingTaskAction(proposeArgs(USER_ID)),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 429);
      return true;
    },
  );
  assert.equal(wasCreateCalled(), false, "create must never be called once the cap is hit");
});

test("createPendingTaskAction: 19 existing PENDING rows for this user still allows creation", async (t) => {
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS - 1 }, () => ({
    userId: USER_ID,
    status: "PENDING",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await createPendingTaskAction(proposeArgs(USER_ID));
  assert.equal(wasCreateCalled(), true);
});

test("createPendingTaskAction: CONFIRMED rows never count toward the cap", async (t) => {
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS + 5 }, () => ({
    userId: USER_ID,
    status: "CONFIRMED",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await createPendingTaskAction(proposeArgs(USER_ID));
  assert.equal(wasCreateCalled(), true);
});

test("createPendingTaskAction: CANCELLED rows never count toward the cap", async (t) => {
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS + 5 }, () => ({
    userId: USER_ID,
    status: "CANCELLED",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await createPendingTaskAction(proposeArgs(USER_ID));
  assert.equal(wasCreateCalled(), true);
});

test("createPendingTaskAction: EXPIRED rows never count toward the cap", async (t) => {
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS + 5 }, () => ({
    userId: USER_ID,
    status: "EXPIRED",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await createPendingTaskAction(proposeArgs(USER_ID));
  assert.equal(wasCreateCalled(), true);
});

test("createPendingTaskAction: the cap is per-user, not global - another user's PENDING rows never block this user", async (t) => {
  const OTHER_USER_ID = "user-2";
  const existing = Array.from({ length: AI_LIMITS.MAX_OPEN_PENDING_ACTIONS }, () => ({
    userId: OTHER_USER_ID,
    status: "PENDING",
  }));
  const wasCreateCalled = mockPendingActionCap(t, existing);

  const { createPendingTaskAction } = await importFreshService();

  await createPendingTaskAction(proposeArgs(USER_ID));
  assert.equal(wasCreateCalled(), true);
});
