import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: mode:'agent' calls runAgentTurn (not runChatTurn) and persists the assistant reply exactly once", async (t) => {
  const appendMessageCalls: { role: string; content: string }[] = [];
  let runChatTurnCalls = 0;
  let runAgentTurnCalls = 0;

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async (_conversationId: string, role: string, content: string) => {
        appendMessageCalls.push({ role, content });
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
        return eventsFrom([
          { type: "text", text: "Agent answer." },
          { type: "done", text: "Agent answer." },
        ]);
      },
    },
  });

  const { postMessage } = await import("./message.controller");

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "agent" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  assert.equal(runAgentTurnCalls, 1, "agent mode must call runAgentTurn");
  assert.equal(runChatTurnCalls, 0, "agent mode must never call runChatTurn");
  assert.deepEqual(appendMessageCalls, [
    { role: "USER", content: "hi" },
    { role: "ASSISTANT", content: "Agent answer." },
  ]);
  assert.equal(appendMessageCalls.length, 2, "the assistant reply must be persisted exactly once");
  assert.ok(state.writes.some((w) => w.startsWith("data: ") && w.includes("Agent answer.")));
  assert.ok(state.writes.some((w) => w.startsWith("event: done")));
});
