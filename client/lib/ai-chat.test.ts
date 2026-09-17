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
  actionType: "CREATE_TASK",
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

const VALID_UPDATE_PENDING_ACTION = {
  actionType: "UPDATE_TASK",
  actionId: "action-2",
  taskId: "task-1",
  taskTitle: "Fix login redirect",
  expiresAt: "2026-01-01T00:15:00.000Z",
  changes: [
    { field: "status", from: "IN_PROGRESS", to: "DONE" },
    { field: "assigneeId", from: "user-1", to: "user-2" },
  ],
};

// --- CREATE_TASK -----------------------------------------------------------

test("streamChatMessage: a valid CREATE_TASK pending_action event parses into a StreamChatEvent with the exact payload", async (t) => {
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

test("streamChatMessage: a malformed CREATE_TASK pending_action event (missing actionId) is silently ignored, and the stream continues to done", async (t) => {
  const malformed = { ...VALID_PENDING_ACTION, actionId: undefined };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(malformed)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"), "a malformed pending_action must never be emitted");
  assert.ok(events.some((e) => e.type === "done"), "the stream must not crash and must still reach done");
});

test("streamChatMessage: a CREATE_TASK pending_action event with an invalid status/priority enum value is silently ignored", async (t) => {
  const invalidStatus = { ...VALID_PENDING_ACTION, status: "NOT_A_REAL_STATUS" };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(invalidStatus)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

// --- actionType discriminator -----------------------------------------

test("streamChatMessage: a pending_action event missing actionType entirely is rejected", async (t) => {
  const missingActionType = { ...VALID_PENDING_ACTION, actionType: undefined };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(missingActionType)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: a pending_action event with an unrecognized actionType is rejected", async (t) => {
  const invalidActionType = { ...VALID_PENDING_ACTION, actionType: "DELETE_TASK" };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(invalidActionType)}\n\nevent: done\ndata: {}\n\n`;

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

// --- UPDATE_TASK -----------------------------------------------------------

test("streamChatMessage: a valid UPDATE_TASK pending_action event parses into a StreamChatEvent with the exact payload", async (t) => {
  const sseText = `event: pending_action\ndata: ${JSON.stringify(VALID_UPDATE_PENDING_ACTION)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action");
  assert.ok(pendingActionEvent, "a pending_action event must be emitted");
  assert.deepEqual((pendingActionEvent as { pendingAction: unknown }).pendingAction, VALID_UPDATE_PENDING_ACTION);
});

test("streamChatMessage: an UPDATE_TASK pending_action missing taskId is rejected", async (t) => {
  const missingTaskId = { ...VALID_UPDATE_PENDING_ACTION, taskId: undefined };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(missingTaskId)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: an UPDATE_TASK pending_action missing taskTitle is rejected", async (t) => {
  const missingTaskTitle = { ...VALID_UPDATE_PENDING_ACTION, taskTitle: undefined };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(missingTaskTitle)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

test("streamChatMessage: an UPDATE_TASK change entry naming an unknown field is dropped, valid entries survive", async (t) => {
  const withBadField = {
    ...VALID_UPDATE_PENDING_ACTION,
    changes: [
      { field: "status", from: "IN_PROGRESS", to: "DONE" },
      { field: "notARealField", from: "x", to: "y" },
    ],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withBadField)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { changes: unknown[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(pendingActionEvent.pendingAction.changes, [{ field: "status", from: "IN_PROGRESS", to: "DONE" }]);
});

test("streamChatMessage: an UPDATE_TASK change entry with a non-string/non-null `from` is dropped", async (t) => {
  const withBadFrom = {
    ...VALID_UPDATE_PENDING_ACTION,
    changes: [
      { field: "status", from: "IN_PROGRESS", to: "DONE" },
      { field: "priority", from: 123, to: "HIGH" },
    ],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withBadFrom)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { changes: unknown[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(pendingActionEvent.pendingAction.changes, [{ field: "status", from: "IN_PROGRESS", to: "DONE" }]);
});

test("streamChatMessage: an UPDATE_TASK change entry with a non-string/non-null `to` is dropped", async (t) => {
  const withBadTo = {
    ...VALID_UPDATE_PENDING_ACTION,
    changes: [
      { field: "status", from: "IN_PROGRESS", to: "DONE" },
      { field: "title", from: "Old", to: 42 },
    ],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withBadTo)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { changes: unknown[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(pendingActionEvent.pendingAction.changes, [{ field: "status", from: "IN_PROGRESS", to: "DONE" }]);
});

test("streamChatMessage: explicit null from/to values in an UPDATE_TASK change are preserved", async (t) => {
  const withNulls = {
    ...VALID_UPDATE_PENDING_ACTION,
    changes: [{ field: "assigneeId", from: "user-1", to: null }],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withNulls)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { changes: unknown[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(pendingActionEvent.pendingAction.changes, [{ field: "assigneeId", from: "user-1", to: null }]);
});

test("streamChatMessage: an UPDATE_TASK pending_action with a malformed (non-array) changes value does not crash the stream", async (t) => {
  const malformedChanges = { ...VALID_UPDATE_PENDING_ACTION, changes: "not-an-array" };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(malformedChanges)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"), "the stream must not crash and must still reach done");
});

test("streamChatMessage: an UPDATE_TASK pending_action with zero valid changes is rejected as malformed", async (t) => {
  const emptyChanges = { ...VALID_UPDATE_PENDING_ACTION, changes: [] };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(emptyChanges)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

// --- CREATE_PROJECT_PLAN (Phase 25 Step 5) --------------------------------

const VALID_PROJECT_PLAN_PENDING_ACTION = {
  actionType: "CREATE_PROJECT_PLAN",
  actionId: "action-3",
  planTitle: "MVP Launch Plan",
  summary: "Get the SaaS MVP launched.",
  expiresAt: "2026-01-01T00:15:00.000Z",
  tasks: [
    { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
    { tempId: "t2", title: "Write onboarding emails", description: "Draft the welcome series", priority: "HIGH" },
  ],
};

// 1. valid single-task plan
test("streamChatMessage: a valid single-task CREATE_PROJECT_PLAN pending_action event parses into a StreamChatEvent with the exact payload", async (t) => {
  const singleTask = { ...VALID_PROJECT_PLAN_PENDING_ACTION, tasks: [VALID_PROJECT_PLAN_PENDING_ACTION.tasks[0]] };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(singleTask)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action");
  assert.ok(pendingActionEvent, "a pending_action event must be emitted");
  assert.deepEqual(pendingActionEvent, { type: "pending_action", pendingAction: singleTask });
});

// 2. valid multi-task plan
test("streamChatMessage: a valid multi-task CREATE_PROJECT_PLAN pending_action event parses into a StreamChatEvent with the exact payload", async (t) => {
  const sseText = `event: pending_action\ndata: ${JSON.stringify(VALID_PROJECT_PLAN_PENDING_ACTION)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);

  const pendingActionEvent = events.find((e) => e.type === "pending_action");
  assert.ok(pendingActionEvent, "a pending_action event must be emitted");
  assert.deepEqual(pendingActionEvent, { type: "pending_action", pendingAction: VALID_PROJECT_PLAN_PENDING_ACTION });
});

// 3. nullable summary
test("streamChatMessage: a CREATE_PROJECT_PLAN pending_action with an explicit null summary survives parsing, and an omitted summary normalizes to null", async (t) => {
  const withNullSummary = { ...VALID_PROJECT_PLAN_PENDING_ACTION, summary: null };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withNullSummary)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { summary: unknown } }
    | undefined;
  assert.equal(pendingActionEvent?.pendingAction.summary, null);

  const { summary, ...omittedSummary } = VALID_PROJECT_PLAN_PENDING_ACTION;
  void summary;
  const sseText2 = `event: pending_action\ndata: ${JSON.stringify(omittedSummary)}\n\nevent: done\ndata: {}\n\n`;
  const events2 = await collectEvents(t, sseText2);
  const pendingActionEvent2 = events2.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { summary: unknown } }
    | undefined;
  assert.equal(pendingActionEvent2?.pendingAction.summary, null);
});

// 4. nullable description
test("streamChatMessage: a CREATE_PROJECT_PLAN task with an explicit null description survives parsing", async (t) => {
  const sseText = `event: pending_action\ndata: ${JSON.stringify(VALID_PROJECT_PLAN_PENDING_ACTION)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { tasks: { description: unknown }[] } }
    | undefined;
  assert.equal(pendingActionEvent?.pendingAction.tasks[0].description, null);
});

// 5. invalid priority
test("streamChatMessage: a CREATE_PROJECT_PLAN task with an invalid priority value is dropped, valid tasks survive", async (t) => {
  const withBadPriority = {
    ...VALID_PROJECT_PLAN_PENDING_ACTION,
    tasks: [VALID_PROJECT_PLAN_PENDING_ACTION.tasks[0], { ...VALID_PROJECT_PLAN_PENDING_ACTION.tasks[1], priority: "BOGUS" }],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withBadPriority)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { tasks: unknown[] } }
    | undefined;
  assert.equal(pendingActionEvent?.pendingAction.tasks.length, 1);
});

// 6. missing actionId
test("streamChatMessage: a CREATE_PROJECT_PLAN pending_action missing actionId is rejected", async (t) => {
  const { actionId, ...missingActionId } = VALID_PROJECT_PLAN_PENDING_ACTION;
  void actionId;
  const sseText = `event: pending_action\ndata: ${JSON.stringify(missingActionId)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  assert.ok(!events.some((e) => e.type === "pending_action"));
});

// 7. missing planTitle
test("streamChatMessage: a CREATE_PROJECT_PLAN pending_action missing planTitle is rejected", async (t) => {
  const { planTitle, ...missingPlanTitle } = VALID_PROJECT_PLAN_PENDING_ACTION;
  void planTitle;
  const sseText = `event: pending_action\ndata: ${JSON.stringify(missingPlanTitle)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  assert.ok(!events.some((e) => e.type === "pending_action"));
});

// 8. malformed task entry
test("streamChatMessage: a CREATE_PROJECT_PLAN task entry with a missing title is dropped, valid entries survive", async (t) => {
  const withMalformedTask = {
    ...VALID_PROJECT_PLAN_PENDING_ACTION,
    tasks: [VALID_PROJECT_PLAN_PENDING_ACTION.tasks[0], { tempId: "t3", priority: "LOW" }],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(withMalformedTask)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { tasks: { tempId: string }[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(
    pendingActionEvent.pendingAction.tasks.map((task) => task.tempId),
    ["t1"],
  );
});

// 9. empty tasks array
test("streamChatMessage: a CREATE_PROJECT_PLAN pending_action with an empty tasks array is rejected as malformed", async (t) => {
  const emptyTasks = { ...VALID_PROJECT_PLAN_PENDING_ACTION, tasks: [] };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(emptyTasks)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

// 10. malformed mixed task array
test("streamChatMessage: a CREATE_PROJECT_PLAN tasks array mixing valid and malformed entries keeps only the valid ones", async (t) => {
  const mixedTasks = {
    ...VALID_PROJECT_PLAN_PENDING_ACTION,
    tasks: [
      VALID_PROJECT_PLAN_PENDING_ACTION.tasks[0],
      { tempId: "", title: "Missing tempId", description: null, priority: "MEDIUM" },
      { tempId: "t4", title: "Bad priority", description: null, priority: 123 },
      { tempId: "t5", title: "Not an array-checked field but fine", description: null, priority: "URGENT" },
    ],
  };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(mixedTasks)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  const pendingActionEvent = events.find((e) => e.type === "pending_action") as
    | { type: "pending_action"; pendingAction: { tasks: { tempId: string }[] } }
    | undefined;
  assert.ok(pendingActionEvent);
  assert.deepEqual(
    pendingActionEvent.pendingAction.tasks.map((task) => task.tempId),
    ["t1", "t5"],
  );
});

test("streamChatMessage: a CREATE_PROJECT_PLAN pending_action with a malformed (non-array) tasks value does not crash the stream", async (t) => {
  const malformedTasks = { ...VALID_PROJECT_PLAN_PENDING_ACTION, tasks: "not-an-array" };
  const sseText = `event: pending_action\ndata: ${JSON.stringify(malformedTasks)}\n\nevent: done\ndata: {}\n\n`;

  const events = await collectEvents(t, sseText);
  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.ok(events.some((e) => e.type === "done"));
});

// --- Existing event types remain unaffected ---------------------------

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
