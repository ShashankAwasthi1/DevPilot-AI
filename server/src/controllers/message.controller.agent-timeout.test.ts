import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: an agent timeout produces exactly one safe SSE error frame, no done frame, and no persisted assistant message", async (t) => {
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
      runAgentTurn: () => eventsFrom([{ type: "error", reason: "timeout" }]),
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
  assert.ok(!errorFrames[0].includes("timeout"), "the raw reason value must never appear in the SSE payload");
  const payload = JSON.parse(errorFrames[0].split("data: ")[1]);
  assert.equal(typeof payload.message, "string");
  assert.ok(payload.message.length > 0);

  assert.ok(!state.writes.some((w) => w.startsWith("event: done")), "no done frame must follow a timeout");
  assert.deepEqual(appendMessageCalls.map((c) => c.role), ["USER"], "only the user message may be persisted - no assistant message after a timeout");
});
