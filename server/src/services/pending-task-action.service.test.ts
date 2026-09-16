import { test } from "node:test";
import assert from "node:assert/strict";

const CONVERSATION_ID = "conversation-1";
const PROJECT_ID = "project-1";
const USER_ID = "user-1";

test("createPendingTaskAction: persists exactly the given conversationId/projectId/userId/proposedInput, and sets expiresAt ~15 minutes ahead", async (t) => {
  let capturedArgs: { data: Record<string, unknown> } | undefined;

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        pendingTaskAction: {
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
