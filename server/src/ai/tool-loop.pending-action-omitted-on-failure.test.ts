import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

// "./tool-loop" is only ever evaluated once per resolved specifier - a
// later t.mock.module call does not retroactively change the bindings a
// module already captured on its first import (same module-cache
// constraint documented throughout this test suite, e.g.
// project-member.service.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own ./tools mock actually takes
// effect.
let importCounter = 0;
function importFreshToolLoop() {
  return import(`./tool-loop?test=${importCounter++}`) as Promise<typeof import("./tool-loop")>;
}

const failingCreateTaskTool = {
  name: "createTask",
  description: "test",
  schema: z.object({ title: z.string() }).strict(),
  handler: async () => {
    throw new Error("simulated proposal failure - e.g. a VIEWER attempting to propose a task");
  },
};

test("runChatTurn: a failed createTask call never yields a pending_action event", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "createTask", input: { title: "Add dark mode support" } },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "I could not propose that task." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [failingCreateTaskTool] } });

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

  assert.ok(
    !events.some((e) => e.type === "pending_action"),
    "a failed tool call must never produce a pending_action event",
  );
  const toolResult = events.find((e) => e.type === "tool_result");
  assert.deepEqual(toolResult, { type: "tool_result", name: "createTask", ok: false });
});

const getTasksTool = {
  name: "getTasks",
  description: "test",
  schema: z.object({}).strict(),
  handler: async () => [{ title: "Task 1" }],
};

test("runChatTurn: a turn with no createTask call at all never yields a pending_action event, and other events are unaffected", async (t) => {
  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "getTasks", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "Here are your tasks." }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [getTasksTool] } });

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

  assert.ok(!events.some((e) => e.type === "pending_action"));
  assert.deepEqual(events.find((e) => e.type === "tool_result"), {
    type: "tool_result",
    name: "getTasks",
    ok: true,
  });
  assert.ok(events.some((e) => e.type === "done"));
});
