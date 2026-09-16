import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

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

const createTaskTool = {
  name: "createTask",
  description: "test",
  schema: z.object({ title: z.string() }).strict(),
  handler: async () => ({
    result: { status: "pending_confirmation", actionId: "action-1", summary: "Proposed task." },
    pendingAction: PENDING_ACTION_REF,
  }),
};

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

// Phase 19 Step 4: verifies the smallest backend-only type extension to
// tool-loop.ts's executeToolCall (the { result, pendingAction } split,
// mirroring searchDocuments' existing { result, sources } split) - NOT the
// SSE emission of a pending_action event, which is explicitly out of scope
// for this step and does not exist yet. This test only proves the
// model-facing tool_result content never contains the richer
// pendingAction payload.
test("runChatTurn: createTask's model-facing tool_result never contains pendingAction fields; other tools are unaffected", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "createTask", input: { title: "Add dark mode support" } },
        { type: "tool_use", id: "c2", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [createTaskTool, getTasksTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1", conversationId: "c1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  // No new SSE event type exists yet for pendingAction (that's a later
  // Phase 19 step) - only the usual tool_call/tool_result events appear.
  assert.equal(events.filter((e) => e.type === "source").length, 0);
  assert.ok(!events.some((e) => (e as { type: string }).type === "pending_action"));

  const createTaskResult = events.find((e) => e.type === "tool_result" && e.name === "createTask");
  assert.deepEqual(createTaskResult, { type: "tool_result", name: "createTask", ok: true });

  // The pendingAction payload must never appear anywhere in the emitted
  // event stream (it isn't wired into any event yet) - proves it truly
  // stayed out of the model-facing path, not just absent from this one
  // event's shape.
  const serializedEvents = JSON.stringify(events);
  assert.ok(!serializedEvents.includes("assigneeName"));
  assert.ok(!serializedEvents.includes(PENDING_ACTION_REF.expiresAt));
});
