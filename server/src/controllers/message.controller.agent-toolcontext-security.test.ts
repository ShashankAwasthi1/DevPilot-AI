import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: agent mode's ToolContext always comes from the authenticated user/route, never from the request body", async (t) => {
  let receivedToolContext: unknown;

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
    namedExports: { runChatTurn: () => eventsFrom([]) },
  });
  t.mock.module("../ai/agent-runner", {
    namedExports: {
      runAgentTurn: (params: { toolContext: unknown }) => {
        receivedToolContext = params.toolContext;
        return eventsFrom([{ type: "done", text: "" }]);
      },
    },
  });

  const { postMessage } = await import("./message.controller");

  // A forged body attempting to smuggle a different identity/project or a
  // whole alternate toolContext through the request payload.
  const { req } = makeFakeRequest({
    projectId: "real-project",
    conversationId: "c1",
    userId: "real-user",
    body: {
      content: "hi",
      mode: "agent",
      userId: "attacker-user",
      projectId: "attacker-project",
      toolContext: { userId: "attacker-user", projectId: "attacker-project" },
    },
  });
  const { res } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  assert.deepEqual(receivedToolContext, { userId: "real-user", projectId: "real-project", conversationId: "c1" });
});
