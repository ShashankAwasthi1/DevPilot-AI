import { test } from "node:test";
import assert from "node:assert/strict";
import { streamChatMessage, type StreamChatEvent } from "./ai-chat";

// Builds a Response whose body streams the given raw SSE text in one
// chunk - enough to exercise streamChatMessage's real frame-parsing logic
// end to end, the same way the browser's fetch would deliver it.
function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collectEvents(t: import("node:test").TestContext, sseText: string): Promise<StreamChatEvent[]> {
  t.mock.method(globalThis, "fetch", async () => sseResponse(sseText));

  const events: StreamChatEvent[] = [];
  await streamChatMessage("project-1", "conversation-1", "hello", {
    onEvent: (event) => events.push(event),
  });
  return events;
}

const VALID_PENDING_ACTION = {
  actionId: "action-1",
  title: "Add dark mode support",
  description: "Some detail",
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: "user-2",
  assigneeName: "Mira Member",
  dueDate: "2026-03-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:15:00.000Z",
};

test("streamChatMessage: a valid pending_action event parses into a StreamChatEvent with the exact payload", async (t) => {
  const sseText = `event: pending_action\ndata: ${JSON.stringify(VALID_PENDING_ACTION)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action");
  assert.ok(pendingActionEvent, "a pending_action event must be emitted");
  assert.deepEqual((pendingActionEvent as { pendingAction: unknown }).pendingAction, VALID_PENDING_ACTION);
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: optional null fields (description/assigneeId/assigneeName/dueDate) survive parsing as null, not dropped", async (t) => {
  const withNulls = {
    ...VALID_PENDING_ACTION,
    description: null,
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withNulls)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: Record<string, unknown> }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.equal(pendingActionEvent.pendingAction.description, null);
  assert.equal(pendingActionEvent.pendingAction.assigneeId, null);
  assert.equal(pendingActionEvent.pendingAction.assigneeName, null);
  assert.equal(pendingActionEvent.pendingAction.dueDate, null);
});

test("streamChatMessage: a malformed pending_action event (missing actionId) is silently ignored, and the stream continues to done", async (t) => {
  const malformed = { ...VALID_PENDING_ACTION, actionId: undefined };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(malformed)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"), "a malformed pending_action must never be emitted");
  assert.ok(events.some((e) => e.type === "done"), "the stream must not crash and must still reach done");
});

test("streamChatMessage: a pending_action event with an invalid status/priority enum value is silently ignored", async (t) => {
  const invalidStatus = { ...VALID_PENDING_ACTION, status: "NOT_A_REAL_STATUS" };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(invalidStatus)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: an empty pending_action data body is ignored safely", async (t) => {
  const sseText = `event: pending_action\ndata: \n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: existing events (text/tool_call/tool_result/source/done) continue to parse exactly as before", async (t) => {
  const sseText = [
    `data: ${JSON.stringify({ delta: "Hello" })}\n\n`,
    `event: tool_call\ndata: ${JSON.stringify({ name: "getTasks", input: {} })}\n\n`,
    `event: tool_result\ndata: ${JSON.stringify({ name: "getTasks", ok: true })}\n\n`,
    `event: source\ndata: ${JSON.stringify({ sources: [{ documentId: "doc-1", title: "Guide" }] })}\n\n`,
    `event: done\ndata: {}\n\n`,
  ].join("");

  const events = await collectEvents(t, sseText);

  assert.deepEqual(events, [
    { type: "text", text: "Hello" },
    { type: "tool_call", name: "getTasks", input: {} },
    { type: "tool_result", name: "getTasks", ok: true },
    { type: "source", sources: [{ documentId: "doc-1", title: "Guide" }] },
    { type: "done" },
  ]);
});

test("streamChatMessage: an unrecognized event type is silently ignored, matching existing fallback behavior (no delta field -> nothing emitted)", async (t) => {
  const sseText = `event: some_future_event\ndata: ${JSON.stringify({ foo: "bar" })}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.deepEqual(events, [{ type: "done" }]);
});
