import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_CONVERSATION_ID = "conversation-1";
const REAL_USER_ID = "user-1";

const updateCalls: { where: unknown; data: unknown }[] = [];

// One shared mock for the whole file, branching on the (id, projectId,
// userId) triple - avoids re-mocking the same module target across
// test() blocks, which would not affect the already-cached
// conversation.service module (see search-documents.tool.scoping.test.ts
// for the same constraint/pattern).
test("updateConversationTitle: an authorized user can update the title, and only the title field is ever written", async (t) => {
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
                title: "Old title",
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              };
            }
            return null;
          },
          update: async (args: { where: unknown; data: unknown }) => {
            updateCalls.push(args);
            return {
              id: REAL_CONVERSATION_ID,
              projectId: REAL_PROJECT_ID,
              userId: REAL_USER_ID,
              title: (args.data as { title: string }).title,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-02T00:00:00.000Z"),
            };
          },
        },
      },
    },
  });

  const { updateConversationTitle } = await import("./conversation.service");

  const result = await updateConversationTitle(REAL_PROJECT_ID, REAL_CONVERSATION_ID, REAL_USER_ID, {
    title: "New title",
  });

  // The update persisted and is reflected in the returned DTO.
  assert.equal(result.title, "New title");
  assert.equal(result.id, REAL_CONVERSATION_ID);
  assert.equal(result.projectId, REAL_PROJECT_ID);
  assert.equal(result.userId, REAL_USER_ID);

  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].where, { id: REAL_CONVERSATION_ID });
  // Only `title` is ever part of the write - proves userId/projectId (or
  // any other field) can never be changed through this function's input.
  assert.deepEqual(Object.keys(updateCalls[0].data as object), ["title"]);
});

test("updateConversationTitle: a nonexistent conversation id is rejected with the existing 404 behavior, and update is never attempted", async () => {
  // No second t.mock.module call here on purpose - see the comment above.
  const { updateConversationTitle } = await import("./conversation.service");
  const before = updateCalls.length;

  await assert.rejects(
    () => updateConversationTitle(REAL_PROJECT_ID, "does-not-exist", REAL_USER_ID, { title: "New title" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(updateCalls.length, before, "update must never be attempted when the access/lookup check fails");
});

test("updateConversationTitle: a conversation belonging to a different project cannot be updated (cross-project isolation)", async () => {
  const { updateConversationTitle } = await import("./conversation.service");
  const before = updateCalls.length;

  await assert.rejects(
    () =>
      updateConversationTitle("someone-elses-project", REAL_CONVERSATION_ID, REAL_USER_ID, {
        title: "New title",
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(updateCalls.length, before);
});

test("updateConversationTitle: a conversation belonging to a different user cannot be updated", async () => {
  const { updateConversationTitle } = await import("./conversation.service");
  const before = updateCalls.length;

  await assert.rejects(() =>
    updateConversationTitle(REAL_PROJECT_ID, REAL_CONVERSATION_ID, "someone-else", { title: "New title" }),
  );

  assert.equal(updateCalls.length, before);
});
