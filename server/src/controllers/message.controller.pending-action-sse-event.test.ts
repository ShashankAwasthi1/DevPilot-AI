import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

// "./message.controller" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same
// module-cache constraint documented throughout this test suite, e.g.
// project-member.service.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own ../ai/tool-loop mock actually
// takes effect.
let importCounter = 0;
function importFreshController() {
  return import(`./message.controller?test=${importCounter++}`) as Promise<
    typeof import("./message.controller")
  >;
}

const PENDING_ACTION_REF = {
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

test("postMessage: a pending_action TurnEvent maps onto an `event: pending_action` SSE frame carrying exactly the pendingAction payload, alongside existing events unaffected", async (t) => {
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
    namedExports: {
      runChatTurn: () =>
        eventsFrom([
          { type: "text", text: "Sure, here's a proposal." },
          { type: "tool_call", name: "createTask", input: { title: "Add dark mode support" } },
          { type: "tool_result", name: "createTask", ok: true },
          { type: "pending_action", pendingAction: PENDING_ACTION_REF },
          { type: "done", text: "Sure, here's a proposal." },
        ]),
    },
  });
  t.mock.module("../ai/agent-runner", { namedExports: { runAgentTurn: () => eventsFrom([]) } });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "Create a task to add dark mode support", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const pendingActionFrame = state.writes.find((w) => w.startsWith("event: pending_action"));
  assert.ok(pendingActionFrame, "a pending_action frame must be written");
  assert.equal(pendingActionFrame, `event: pending_action\ndata: ${JSON.stringify(PENDING_ACTION_REF)}\n\n`);

  // Never carries userId/projectId/conversationId - only the presentation
  // fields already validated by extractPendingAction.
  assert.deepEqual(Object.keys(PENDING_ACTION_REF).sort(), [
    "actionId",
    "assigneeId",
    "assigneeName",
    "description",
    "dueDate",
    "expiresAt",
    "priority",
    "status",
    "title",
  ]);
  assert.ok(!pendingActionFrame!.includes("userId"));
  assert.ok(!pendingActionFrame!.includes("projectId"));
  assert.ok(!pendingActionFrame!.includes("conversationId"));

  // Existing events remain unaffected: text/tool_call/tool_result/done all
  // still appear exactly as before.
  assert.ok(state.writes.includes(`data: ${JSON.stringify({ delta: "Sure, here's a proposal." })}\n\n`));
  assert.ok(
    state.writes.includes(
      `event: tool_call\ndata: ${JSON.stringify({ name: "createTask", input: { title: "Add dark mode support" } })}\n\n`,
    ),
  );
  assert.ok(
    state.writes.includes(`event: tool_result\ndata: ${JSON.stringify({ name: "createTask", ok: true })}\n\n`),
  );
  assert.ok(state.writes.includes("event: done\ndata: {}\n\n"));

  // Ordering: pending_action must appear after createTask's own
  // tool_result, matching tool-loop.ts's yield order.
  const toolResultIndex = state.writes.findIndex((w) => w.startsWith("event: tool_result"));
  const pendingActionIndex = state.writes.findIndex((w) => w.startsWith("event: pending_action"));
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);
});

const UPDATE_PENDING_ACTION_REF = {
  actionType: "UPDATE_TASK",
  actionId: "action-2",
  taskId: "task-1",
  taskTitle: "Fix login redirect",
  expiresAt: "2026-01-01T00:15:00.000Z",
  changes: [{ field: "status", from: "IN_PROGRESS", to: "DONE" }],
};

test("postMessage: an UPDATE_TASK pending_action TurnEvent maps onto the exact same generic SSE frame - no separate event type, discriminated by actionType", async (t) => {
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
    namedExports: {
      runChatTurn: () =>
        eventsFrom([
          { type: "text", text: "Here's a proposed change." },
          { type: "tool_call", name: "updateTask", input: { taskId: "task-1", status: "DONE" } },
          { type: "tool_result", name: "updateTask", ok: true },
          { type: "pending_action", pendingAction: UPDATE_PENDING_ACTION_REF },
          { type: "done", text: "Here's a proposed change." },
        ]),
    },
  });
  t.mock.module("../ai/agent-runner", { namedExports: { runAgentTurn: () => eventsFrom([]) } });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "Mark the login redirect task as done", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  const pendingActionFrame = state.writes.find((w) => w.startsWith("event: pending_action"));
  assert.ok(pendingActionFrame, "a pending_action frame must be written");
  assert.equal(
    pendingActionFrame,
    `event: pending_action\ndata: ${JSON.stringify(UPDATE_PENDING_ACTION_REF)}\n\n`,
  );

  // Never carries userId/projectId/conversationId, and never a raw
  // snapshot - only the presentation fields extractPendingAction already
  // validated.
  assert.ok(!pendingActionFrame!.includes("userId"));
  assert.ok(!pendingActionFrame!.includes("projectId"));
  assert.ok(!pendingActionFrame!.includes("conversationId"));
  assert.ok(!pendingActionFrame!.includes("snapshot"));

  // The stream never implies the task was already updated - only that a
  // change is proposed.
  assert.ok(!pendingActionFrame!.includes("updated successfully"));

  // Ordering matches tool-loop.ts's own yield order: tool_result -> pending_action.
  const toolResultIndex = state.writes.findIndex((w) => w.startsWith("event: tool_result"));
  const pendingActionIndex = state.writes.findIndex((w) => w.startsWith("event: pending_action"));
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);
});

test("postMessage: no pending_action frame is written when no pending_action event occurs", async (t) => {
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
    namedExports: {
      runChatTurn: () =>
        eventsFrom([
          { type: "text", text: "Here is your answer." },
          { type: "done", text: "Here is your answer." },
        ]),
    },
  });
  t.mock.module("../ai/agent-runner", { namedExports: { runAgentTurn: () => eventsFrom([]) } });

  const { postMessage } = await importFreshController();

  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "What's the status of this project?", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());

  assert.ok(!state.writes.some((w) => w.startsWith("event: pending_action")));
});
