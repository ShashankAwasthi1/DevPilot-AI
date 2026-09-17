import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// "./tool-loop" is only ever evaluated once per resolved specifier - a
// later t.mock.module call does not retroactively change the bindings a
// module already captured on its first import (same module-cache
// constraint documented throughout this suite, e.g.
// tool-loop.pending-action-omitted-on-failure.test.ts). A unique query
// string per test forces a fresh module instance, so each test's own
// ./tools mock actually takes effect.
let importCounter = 0;
function importFreshToolLoop() {
  return import(`./tool-loop?test=${importCounter++}`) as Promise<typeof import("./tool-loop")>;
}

const PENDING_ACTION_REF = {
  actionType: "CREATE_PROJECT_PLAN",
  actionId: "action-1",
  planTitle: "MVP Launch Plan",
  summary: "Get the SaaS MVP launched.",
  tasks: [
    { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
    { tempId: "t2", title: "Write onboarding emails", description: "Draft the welcome series", priority: "HIGH" },
  ],
  expiresAt: "2026-01-01T00:15:00.000Z",
};

const generateProjectPlanTool = {
  name: "generateProjectPlan",
  description: "test",
  schema: z.object({ planTitle: z.string() }).strict(),
  handler: async () => ({
    result: { status: "pending_confirmation", actionId: "action-1", summary: "Proposed a plan with 2 tasks." },
    pendingAction: PENDING_ACTION_REF,
  }),
};

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

// Mirrors tool-loop.create-task-pending-action.test.ts's/
// tool-loop.update-task-pending-action.test.ts's structure exactly - chat
// mode's bridging is identical across all three proposal tools, all going
// through the same shared extractPendingAction/executeToolCall recognition
// (by tool name), never a parallel mechanism.
test("runChatTurn: generateProjectPlan's model-facing tool_result never contains pendingAction fields, which instead appear only in a dedicated pending_action event; other tools are unaffected", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "generateProjectPlan", input: { planTitle: "MVP Launch Plan" } },
        { type: "tool_use", id: "c2", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [generateProjectPlanTool, getTasksTool] } });

  const { runChatTurn } = await importFreshToolLoop();

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
  assert.equal(pendingActionEvents.length, 1, "exactly one pending_action event for the one generateProjectPlan call");
  assert.deepEqual(pendingActionEvents[0], { type: "pending_action", pendingAction: PENDING_ACTION_REF });

  // Ordering: tool_result -> pending_action, same as createTask's/
  // updateTask's own yield order.
  const toolResultIndex = events.findIndex((e) => e.type === "tool_result" && e.name === "generateProjectPlan");
  const pendingActionIndex = events.findIndex((e) => e.type === "pending_action");
  assert.ok(toolResultIndex !== -1 && pendingActionIndex > toolResultIndex);

  const planResult = events.find((e) => e.type === "tool_result" && e.name === "generateProjectPlan");
  assert.deepEqual(planResult, { type: "tool_result", name: "generateProjectPlan", ok: true });

  // The model-facing tool_result content is still exactly the minimal ack
  // - the richer pendingAction fields (planTitle, tasks, etc.) never appear
  // anywhere in a tool_call/tool_result event, only in the dedicated
  // pending_action event asserted above. This also proves the stream never
  // implies any task was already created - only that a proposal is
  // pending.
  const toolCallAndResultEvents = events.filter((e) => e.type === "tool_call" || e.type === "tool_result");
  const serialized = JSON.stringify(toolCallAndResultEvents);
  assert.ok(!serialized.includes("Set up hosting"));
  assert.ok(!serialized.includes("tempId"));
  assert.ok(!serialized.includes("created successfully"));
});

test("runChatTurn: a failed generateProjectPlan call never yields a pending_action event", async (t) => {
  const failingTool = {
    name: "generateProjectPlan",
    description: "test",
    schema: z.object({ planTitle: z.string() }).strict(),
    handler: async () => {
      throw new Error("boom");
    },
  };

  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "generateProjectPlan", input: { planTitle: "Plan" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [failingTool] } });

  const { runChatTurn } = await importFreshToolLoop();

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1", conversationId: "c1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.equal(events.filter((e) => e.type === "pending_action").length, 0);
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "generateProjectPlan" && e.ok === false));
});
