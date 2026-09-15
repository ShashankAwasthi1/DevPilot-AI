import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: a request with no mode field uses chat mode (runChatTurn), never the agent runner", async (t) => {
  const appendMessageCalls: { conversationId: string; role: string; content: string }[] = [];
  let runChatTurnCalls = 0;
  let runAgentTurnCalls = 0;

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async (conversationId: string, role: string, content: string) => {
        appendMessageCalls.push({ conversationId, role, content });
        return { id: "m1" };
      },
      listRecentHistory: async () => [{ role: "USER", content: "hi", id: "m0", conversationId: "c1", createdAt: new Date() }],
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
        return eventsFrom([
          { type: "text", text: "Hello" },
          { type: "done", text: "Hello" },
        ]);
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
    body: { content: "hi" }, // no mode field at all
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  assert.equal(runChatTurnCalls, 1, "chat mode must call runChatTurn");
  assert.equal(runAgentTurnCalls, 0, "chat mode must never call runAgentTurn");
  assert.deepEqual(appendMessageCalls.map((c) => c.role), ["USER", "ASSISTANT"]);
  assert.equal(appendMessageCalls[1].content, "Hello");
  assert.ok(state.writes.some((w) => w.includes("Hello")));
  assert.ok(state.ended);
});
