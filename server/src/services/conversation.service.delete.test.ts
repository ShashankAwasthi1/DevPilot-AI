import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_CONVERSATION_ID = "conversation-1";
const REAL_USER_ID = "user-1";

const deleteCalls: { where: unknown }[] = [];
let messageTableTouched = false;

// One shared mock for the whole file, branching on the (id, projectId,
// userId) triple - same convention as
// conversation.service.update-title.test.ts.
test("deleteConversation: an authorized user can delete their conversation via a genuine hard delete, and no unrelated table is touched", async (t) => {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        conversation: {
          findFirst: async ({ where }: { where: { id: string; projectId: string; userId: string } }) => {
            if (
              where.id === REAL_CONVERSATION_ID &&
              where.projectId === REAL_PROJECT_ID &&
              where.userId === REAL_USER_ID
            ) {
              return {
                id: REAL_CONVERSATION_ID,
                projectId: REAL_PROJECT_ID,
                userId: REAL_USER_ID,
                title: "A conversation",
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              };
            }
            return null;
          },
          delete: async (args: { where: unknown }) => {
            deleteCalls.push(args);
            return {
              id: REAL_CONVERSATION_ID,
              projectId: REAL_PROJECT_ID,
              userId: REAL_USER_ID,
              title: "A conversation",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            };
          },
        },
        // No method here should ever be called by deleteConversation -
        // message cleanup must happen exclusively through Prisma's own
        // Conversation -> Message onDelete: Cascade relation, never a
        // manual query from this service.
        message: {
          deleteMany: async () => {
            messageTableTouched = true;
            return { count: 0 };
          },
        },
      },
    },
  });

  const { deleteConversation } = await import("./conversation.service");

  await deleteConversation(REAL_PROJECT_ID, REAL_CONVERSATION_ID, REAL_USER_ID);

  assert.equal(deleteCalls.length, 1);
  // A real Prisma delete, not an update setting some soft-delete/archived
  // flag - the exact row is targeted by id, nothing else.
  assert.deepEqual(deleteCalls[0].where, { id: REAL_CONVERSATION_ID });
  assert.equal(messageTableTouched, false, "message cleanup must rely solely on the cascade relation, never a manual query");
});

test("deleteConversation: a nonexistent conversation id is rejected with the existing 404 behavior, and delete is never attempted", async () => {
  // No second t.mock.module call here on purpose - see the comment above.
  const { deleteConversation } = await import("./conversation.service");
  const before = deleteCalls.length;

  await assert.rejects(
    () => deleteConversation(REAL_PROJECT_ID, "does-not-exist", REAL_USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(deleteCalls.length, before, "delete must never be attempted when the access/lookup check fails");
});

test("deleteConversation: a conversation belonging to a different project cannot be deleted (cross-project isolation)", async () => {
  const { deleteConversation } = await import("./conversation.service");
  const before = deleteCalls.length;

  await assert.rejects(
    () => deleteConversation("someone-elses-project", REAL_CONVERSATION_ID, REAL_USER_ID),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(deleteCalls.length, before);
});

test("deleteConversation: a conversation belonging to a different user cannot be deleted", async () => {
  const { deleteConversation } = await import("./conversation.service");
  const before = deleteCalls.length;

  await assert.rejects(() => deleteConversation(REAL_PROJECT_ID, REAL_CONVERSATION_ID, "someone-else"));

  assert.equal(deleteCalls.length, before);
});
