import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: exactly one USER append and one ASSISTANT append occur for a single successful chat turn - no duplicates", async (t) => {
  const appendMessageCalls: { role: string; content: string }[] = [];

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async (_c: string, role: string, content: string) => {
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
      runChatTurn: () =>
        eventsFrom([
          { type: "text", text: "Part one. " },
          { type: "text", text: "Part two." },
          { type: "done", text: "Part one. Part two." },
        ]),
    },
  });
  t.mock.module("../ai/agent-runner", {
    namedExports: { runAgentTurn: () => eventsFrom([]) },
  });

  const { postMessage } = await import("./message.controller");

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hello" },
  });
  const { res } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const userAppends = appendMessageCalls.filter((c) => c.role === "USER");
  const assistantAppends = appendMessageCalls.filter((c) => c.role === "ASSISTANT");
  assert.equal(userAppends.length, 1);
  assert.equal(assistantAppends.length, 1);
  assert.equal(userAppends[0].content, "hello");
  // The final assistant text is the done event's accumulated text, not a
  // second copy of an individual text delta.
  assert.equal(assistantAppends[0].content, "Part one. Part two.");
});
