import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderUnavailableError } from "../ai/provider";
import { makeFakeRequest, makeFakeResponse, throwingNext } from "./test-helpers";

// Chat mode (runChatTurn) has no in-band { type: "error" } event - it only
// ever throws, landing in postMessage's outer catch block. This proves
// that catch block distinguishes a ProviderUnavailableError (the
// provider's own retry/backoff already exhausted) from any other thrown
// error, surfacing the same specific message agent mode's
// AGENT_ERROR_MESSAGES.provider_unavailable uses - not the fully generic
// fallback.

let importCounter = 0;
function importFreshController() {
  return import(`./message.controller?test=${importCounter++}`) as Promise<
    typeof import("./message.controller")
  >;
}

function mockCommonServices(t: import("node:test").TestContext) {
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
}

test("postMessage (chat mode): a thrown ProviderUnavailableError produces the specific temporarily-unavailable message, never the raw provider status/text", async (t) => {
  mockCommonServices(t);
  t.mock.module("../ai/tool-loop", {
    namedExports: {
      runChatTurn: async function* () {
        throw new ProviderUnavailableError("Gemini API returned 503: This model is currently experiencing high demand.");
      },
    },
  });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const errorFrame = state.writes.find((w) => w.startsWith("event: error"));
  assert.ok(errorFrame);
  const payload = JSON.parse(errorFrame!.split("data: ")[1]) as { message: string };
  assert.equal(payload.message, "The AI service is temporarily unavailable. Please try again.");
  assert.equal(errorFrame!.includes("503"), false);
  assert.equal(errorFrame!.includes("high demand"), false);
});

test("postMessage (chat mode): any other thrown error still produces the fully generic message, unchanged", async (t) => {
  mockCommonServices(t);
  t.mock.module("../ai/tool-loop", {
    namedExports: {
      runChatTurn: async function* () {
        throw new Error("some other genuine failure");
      },
    },
  });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const errorFrame = state.writes.find((w) => w.startsWith("event: error"));
  assert.ok(errorFrame);
  const payload = JSON.parse(errorFrame!.split("data: ")[1]) as { message: string };
  assert.equal(payload.message, "Something went wrong generating a response.");
});
