import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeJsonResponse, makeFakeRequest, throwingNext } from "./test-helpers";

test("deleteConversation: an authenticated request reaches the delete service with exactly the right IDs, and returns 200 with an empty data object", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../services/conversation.service", {
    namedExports: {
      deleteConversation: async (...args: unknown[]) => {
        recordedArgs = args;
      },
    },
  });
  t.mock.module("../services/message.service", { namedExports: {} });

  const { deleteConversation } = await import("./conversation.controller");

  const { req } = makeFakeRequest({
    projectId: "project-1",
    conversationId: "conversation-1",
    userId: "user-1",
    body: {},
  });
  const { res, state } = makeFakeJsonResponse();

  await deleteConversation(req, res, throwingNext());

  assert.deepEqual(recordedArgs, ["project-1", "conversation-1", "user-1"]);

  // Exactly HTTP 200 with { status: "ok", data: {} } - never 204, since
  // the client's request() helper always attempts to parse a JSON body.
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { status: "ok", data: {} });
});
