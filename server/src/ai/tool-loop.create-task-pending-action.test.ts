import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

const PENDING_ACTION_REF = {
  actionType: "CREATE_TASK",
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

// Phase 19 Step 4 originally verified the { result, pendingAction } split
// on ToolExecutionResult with no SSE wiring yet. Step 7B-0 wires that split
// into a real `pending_action` TurnEvent - this test is updated to assert
// the now-correct end state: the richer pendingAction payload appears ONLY
// in its own dedicated event, never inside the model-facing tool_result
// content.
test("runChatTurn: createTask's model-facing tool_result never contains pendingAction fields, which instead appear only in a dedicated pending_action event; other tools are unaffected", async (t) => {
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

  assert.equal(events.filter((e) => e.type === "source").length, 0);

  const pendingActionEvents = events.filter((e) => e.type === "pending_action");
  assert.equal(pendingActionEvents.length, 1, "exactly one pending_action event for the one createTask call");
  assert.deepEqual(pendingActionEvents[0], { type: "pending_action", pendingAction: PENDING_ACTION_REF });

  // getTasks (a plain read tool, unrelated to createTask) must never
  // produce one.
  assert.equal(
    events.filter((e) => e.type === "tool_result" && e.name === "getTasks").length,
    1,
  );

  const createTaskResult = events.find((e) => e.type === "tool_result" && e.name === "createTask");
  assert.deepEqual(createTaskResult, { type: "tool_result", name: "createTask", ok: true });

  // The model-facing tool_result content is still exactly the minimal ack
  // - the richer pendingAction fields (assigneeName, expiresAt, etc.) never
  // appear anywhere in a tool_call/tool_result event, only in the
  // dedicated pending_action event asserted above.
  const toolCallAndResultEvents = events.filter((e) => e.type === "tool_call" || e.type === "tool_result");
  const serialized = JSON.stringify(toolCallAndResultEvents);
  assert.ok(!serialized.includes("assigneeName"));
  assert.ok(!serialized.includes(PENDING_ACTION_REF.expiresAt));
});
