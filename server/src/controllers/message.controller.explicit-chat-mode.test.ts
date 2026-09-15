import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: an explicit mode:'chat' still calls runChatTurn, not the agent runner", async (t) => {
  let runChatTurnCalls = 0;
  let runAgentTurnCalls = 0;

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async () => ({ id: "m1" }),
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
        return eventsFrom([{ type: "done", text: "ok" }]);
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
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  assert.equal(runChatTurnCalls, 1);
  assert.equal(runAgentTurnCalls, 0);
});
