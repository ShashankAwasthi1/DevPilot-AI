import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

// "./message.controller" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same
// module-cache constraint documented throughout this suite, e.g.
// message.controller.pending-action-sse-event.test.ts). A unique query
// string per test forces a fresh module instance, so each test's own
// ../ai/agent-runner mock actually takes effect.
let importCounter = 0;
function importFreshController() {
  return import(`./message.controller?test=${importCounter++}`) as Promise<
    typeof import("./message.controller")
  >;
}

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

  const { postMessage } = await importFreshController();

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

const AGENT_PENDING_ACTION_REF = {
  actionId: "action-1",
  title: "Add dark mode support",
  description: null,
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  expiresAt: "2026-01-01T00:15:00.000Z",
};

test("postMessage: an agent-mode pending_action event maps onto the exact same `event: pending_action` SSE frame as chat mode", async (t) => {
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
  t.mock.module("../ai/tool-loop", { namedExports: { runChatTurn: () => eventsFrom([]) } });
  t.mock.module("../ai/agent-runner", {
    namedExports: {
      runAgentTurn: () =>
        eventsFrom([
          { type: "text", text: "Sure, here's a proposal." },
          { type: "tool_call", name: "createTask", input: { title: "Add dark mode support" } },
          { type: "tool_result", name: "createTask", ok: true },
          { type: "pending_action", pendingAction: AGENT_PENDING_ACTION_REF },
          { type: "done", text: "Sure, here's a proposal." },
        ]),
    },
  });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "Create a task to add dark mode support", mode: "agent" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const pendingActionFrame = state.writes.find((w) => w.startsWith("event: pending_action"));
  assert.equal(pendingActionFrame, `event: pending_action\ndata: ${JSON.stringify(AGENT_PENDING_ACTION_REF)}\n\n`);

  // Ordering matches agent-runner.ts's own yield order: tool_result -> pending_action.
  const toolResultIndex = state.writes.findIndex((w) => w.startsWith("event: tool_result"));
  const pendingActionIndex = state.writes.findIndex((w) => w.startsWith("event: pending_action"));
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);

  assert.ok(state.writes.includes("event: done\ndata: {}\n\n"));
});
