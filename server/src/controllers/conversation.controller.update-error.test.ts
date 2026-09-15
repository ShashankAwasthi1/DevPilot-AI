import { test } from "node:test";
import assert from "node:assert/strict";
import { capturingNext, makeFakeJsonResponse, makeFakeRequest } from "./test-helpers";

test("updateConversation: a service failure (e.g. the existing 404 for a nonexistent/foreign conversation) is forwarded to next(err), not swallowed or converted", async (t) => {
  class FakeAppError extends Error {
    statusCode = 404;
  }

  t.mock.module("../services/conversation.service", {
    namedExports: {
      updateConversationTitle: async () => {
        throw new FakeAppError("Conversation not found");
      },
    },
  });
  t.mock.module("../services/message.service", { namedExports: {} });

  const { updateConversation } = await import("./conversation.controller");

  const { req } = makeFakeRequest({
    projectId: "project-1",
    conversationId: "does-not-exist",
    userId: "user-1",
    body: { title: "New title" },
  });
  const { res } = makeFakeJsonResponse();
  const { next, errors } = capturingNext();

  await updateConversation(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal((errors[0] as FakeAppError).statusCode, 404);
});
