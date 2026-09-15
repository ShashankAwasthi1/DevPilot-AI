import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeJsonResponse, makeFakeRequest, throwingNext } from "./test-helpers";

test("updateConversation: an authenticated request with a validated title reaches the service with exactly the right args, and returns the updated conversation", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/conversation.service", {
    namedExports: {
      updateConversationTitle: async (...args: unknown[]) => {
        recordedArgs = args;
        return {
          id: "conversation-1",
          projectId: "project-1",
          userId: "user-1",
          title: "New title",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        };
      },
    },
  });
  t.mock.module("../services/message.service", { namedExports: {} });

  const { updateConversation } = await import("./conversation.controller");

  const { req } = makeFakeRequest({
    projectId: "project-1",
    conversationId: "conversation-1",
    userId: "user-1",
    // Already validated/normalized by validate(updateConversationSchema)
    // by the time the controller runs - the controller never re-validates.
    body: { title: "New title" },
  });
  const { res, state } = makeFakeJsonResponse();

  await updateConversation(req, res, throwingNext());

  // projectId/conversationId/userId all come from the route param and the
  // authenticated session, never from the body - and the title is exactly
  // what the (already-validated) body carried.
  assert.deepEqual(recordedArgs, ["project-1", "conversation-1", "user-1", { title: "New title" }]);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    status: "ok",
    data: {
      conversation: {
        id: "conversation-1",
        projectId: "project-1",
        userId: "user-1",
        title: "New title",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    },
  });
});
