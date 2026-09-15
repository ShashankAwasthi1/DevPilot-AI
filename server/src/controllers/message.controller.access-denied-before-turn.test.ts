import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, capturingNext, eventsFrom } from "./test-helpers";

test("postMessage: an authorization failure is forwarded to next(err) before either orchestrator ever runs, regardless of mode", async (t) => {
  let runChatTurnCalls = 0;
  let runAgentTurnCalls = 0;
  let appendMessageCalls = 0;

  class FakeAppError extends Error {}

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {
        throw new FakeAppError("Project not found");
      },
      appendMessage: async () => {
        appendMessageCalls++;
        return { id: "m1" };
      },
      listRecentHistory: async () => [],
    },
  });
  t.mock.module("../services/ai-context.service", {
    namedExports: {
      buildProjectContext: async () => ({ projectName: "Demo", projectDescription: null }),
    },
  });
  t.mock.module("../ai/tool-loop", {
    namedExports: {
      runChatTurn: () => {
        runChatTurnCalls++;
        return eventsFrom([]);
      },
    },
  });
  t.mock.module("../ai/agent-runner", {
    namedExports: {
      runAgentTurn: () => {
        runAgentTurnCalls++;
        return eventsFrom([]);
      },
    },
  });

  const { postMessage } = await import("./message.controller");

  const { req } = makeFakeRequest({
    projectId: "someone-elses-project",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "agent" },
  });
  const { res, state } = makeFakeResponse();
  const { next, errors } = capturingNext();

  await postMessage(req, res, next);

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof FakeAppError);
  assert.equal(runChatTurnCalls, 0);
  assert.equal(runAgentTurnCalls, 0);
  assert.equal(appendMessageCalls, 0, "no user message should be persisted when access is denied");
  assert.equal(state.writes.length, 0, "no SSE frame should ever be written for a pre-stream access failure");
});
