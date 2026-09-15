import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: an agent provider_error produces exactly one safe SSE error frame, no done frame, and no persisted assistant message", async (t) => {
  const appendMessageCalls: { role: string }[] = [];

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async (_c: string, role: string) => {
        appendMessageCalls.push({ role });
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
    namedExports: { runChatTurn: () => eventsFrom([]) },
  });
  t.mock.module("../ai/agent-runner", {
    namedExports: {
      runAgentTurn: () => eventsFrom([{ type: "error", reason: "provider_error" }]),
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

  const errorFrames = state.writes.filter((w) => w.startsWith("event: error"));
  assert.equal(errorFrames.length, 1);
  assert.ok(!errorFrames[0].includes("provider_error"), "the raw reason value must never appear in the SSE payload");
  assert.ok(!state.writes.some((w) => w.startsWith("event: done")));
  assert.deepEqual(appendMessageCalls.map((c) => c.role), ["USER"]);
});
