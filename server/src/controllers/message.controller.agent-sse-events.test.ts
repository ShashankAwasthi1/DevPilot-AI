import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

test("postMessage: agent text/tool_call/tool_result/done events map onto the exact existing SSE frames, and tool_result never carries a raw result", async (t) => {
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
      runAgentTurn: () =>
        eventsFrom([
          { type: "text", text: "Looking that up..." },
          { type: "tool_call", name: "searchDocuments", input: { query: "auth" } },
          // A raw tool result would contain document content/ids/scores -
          // AgentTurnEvent structurally never carries any of that, only ok.
          { type: "tool_result", name: "searchDocuments", ok: true },
          { type: "text", text: "Here you go." },
          { type: "done", text: "Looking that up...Here you go." },
        ]),
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

  assert.ok(state.writes.includes(`data: ${JSON.stringify({ delta: "Looking that up..." })}\n\n`));
  assert.ok(
    state.writes.includes(
      `event: tool_call\ndata: ${JSON.stringify({ name: "searchDocuments", input: { query: "auth" } })}\n\n`,
    ),
  );
  assert.ok(
    state.writes.includes(`event: tool_result\ndata: ${JSON.stringify({ name: "searchDocuments", ok: true })}\n\n`),
  );
  assert.ok(state.writes.includes(`data: ${JSON.stringify({ delta: "Here you go." })}\n\n`));
  assert.ok(state.writes.includes("event: done\ndata: {}\n\n"));

  // The tool_result frame is exactly { name, ok } - never a document id,
  // content, or distance score, even though the mocked AgentTurnEvent
  // itself only ever carries those two fields (structurally enforced one
  // layer down, in agent-runner.ts).
  const toolResultFrame = state.writes.find((w) => w.startsWith("event: tool_result"));
  assert.equal(toolResultFrame, `event: tool_result\ndata: ${JSON.stringify({ name: "searchDocuments", ok: true })}\n\n`);
});
