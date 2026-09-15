import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSystemPrompt, buildSystemPrompt } from "../ai/prompt";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

const FIXED_CONTEXT = { projectName: "Demo Project", projectDescription: "A test project." };

test("postMessage: agent mode passes buildAgentSystemPrompt's output to runAgentTurn, not the plain chat system prompt", async (t) => {
  let receivedSystemPrompt: string | undefined;

  t.mock.module("../services/message.service", {
    namedExports: {
      assertConversationWritable: async () => {},
      appendMessage: async () => ({ id: "m1" }),
      listRecentHistory: async () => [],
    },
  });
  t.mock.module("../services/ai-context.service", {
    namedExports: {
      buildProjectContext: async () => FIXED_CONTEXT,
    },
  });
  t.mock.module("../ai/tool-loop", {
    namedExports: { runChatTurn: () => eventsFrom([]) },
  });
  t.mock.module("../ai/agent-runner", {
    namedExports: {
      runAgentTurn: (params: { systemPrompt: string }) => {
        receivedSystemPrompt = params.systemPrompt;
        return eventsFrom([{ type: "done", text: "" }]);
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
  const { res } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  // Asserted against the real, unmocked buildAgentSystemPrompt's actual
  // output for the same context - not a duplicated/hand-copied prompt
  // string - so this test tracks the real implementation rather than a
  // second, driftable copy of it.
  assert.equal(receivedSystemPrompt, buildAgentSystemPrompt(FIXED_CONTEXT));

  // And explicitly distinct from the plain chat prompt for the same
  // context, proving agent mode did not fall back to the ordinary prompt.
  assert.notEqual(receivedSystemPrompt, buildSystemPrompt(FIXED_CONTEXT));
});
