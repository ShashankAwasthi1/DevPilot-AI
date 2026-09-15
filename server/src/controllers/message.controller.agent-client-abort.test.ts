import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: a client disconnect during agent mode never surfaces as an SSE error and never persists an assistant message", async (t) => {
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
      // Mirrors AgentRunner's real client-abort semantics: yields whatever
      // it already had, then waits on the caller signal and returns
      // silently (no error, no done) once it fires - never throws.
      runAgentTurn: (params: { signal: AbortSignal }) =>
        (async function* () {
          yield { type: "text", text: "partial" };
          await new Promise<void>((resolve) => {
            if (params.signal.aborted) {
              resolve();
              return;
            }
            params.signal.addEventListener("abort", () => resolve());
          });
        })(),
    },
  });

  const { postMessage } = await import("./message.controller");

  const { req, triggerClose } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "agent" },
  });
  const { res, state } = makeFakeResponse();

  const postMessagePromise = postMessage(req, res, throwingNext());
  // Let the generator start and yield its first event before disconnecting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  triggerClose();
  await postMessagePromise;

  assert.ok(!state.writes.some((w) => w.startsWith("event: error")), "a client abort must never become an SSE error");
  assert.deepEqual(appendMessageCalls.map((c) => c.role), ["USER"], "no assistant message may be persisted after a client abort");
});
