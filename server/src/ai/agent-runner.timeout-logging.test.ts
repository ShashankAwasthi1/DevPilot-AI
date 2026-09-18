import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeHangingProvider } from "./fixtures";

// Phase 27 bug-fix: agent-runner's timeout path previously yielded
// { type: "error", reason: "timeout" } with zero server-side logging,
// which is why a real production timeout left no trace in the backend
// terminal. These tests prove the fix: a timeout is now logged safely,
// exactly once, with only non-sensitive context.
//
// "./agent-runner" is only ever evaluated once per resolved specifier - a
// later t.mock.module call does not retroactively change the bindings a
// module already captured on its first import (same module-cache
// constraint documented throughout this codebase). A unique query string
// per test forces a fresh module instance so each test's own mocks
// actually take effect.
let importCounter = 0;
function importFreshAgentRunner() {
  return import(`./agent-runner?test=${importCounter++}`) as Promise<typeof import("./agent-runner")>;
}

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

// Node itself can emit its own one-time, process-level console.error
// output (e.g. "ExperimentalWarning: Module mocking is an experimental
// feature...") the first time mock.module/mock.method are used in a
// process - unrelated to this code, but captured by a console.error mock
// all the same. Filtering for the log text this function actually
// produces keeps these tests robust regardless of whether that Node
// warning happens to land during a given test.
function timeoutLogs(errorLogs: unknown[][]): unknown[][] {
  return errorLogs.filter((args) => args.some((arg) => String(arg).includes("timed out")));
}

test("runAgentTurn: a timeout logs safely exactly once, including the timeout duration and project/user ids, and still yields the same timeout event as before", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  const { provider } = makeHangingProvider();
  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await importFreshAgentRunner();

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "user-42", projectId: "project-7" },
    signal: new AbortController().signal,
    limits: { timeoutMs: 30 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "error", reason: "timeout" }]);

  const logs = timeoutLogs(errorLogs);
  assert.equal(logs.length, 1, "a timeout must be logged exactly once, never zero, never duplicated");
  const loggedText = logs[0].map(String).join(" ");
  assert.match(loggedText, /timed out/i);
  assert.match(loggedText, /30/, "the configured timeout duration must appear in the log");
  assert.match(loggedText, /project-7/, "projectId is safe, non-sensitive context and should be logged");
  assert.match(loggedText, /user-42/, "userId is safe, non-sensitive context and should be logged");
});

test("runAgentTurn: a timeout's log never contains prompt/history content or any provider/tool output", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  const { provider } = makeHangingProvider({ textBeforeHang: "some partial answer text" });
  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await importFreshAgentRunner();

  const secretLookingPrompt = "the user's private system prompt content";
  for await (const _event of runAgentTurn({
    systemPrompt: secretLookingPrompt,
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "user-42", projectId: "project-7" },
    signal: new AbortController().signal,
    limits: { timeoutMs: 30 },
  })) {
    // drain
  }

  const logs = timeoutLogs(errorLogs);
  assert.equal(logs.length, 1);
  const loggedText = logs[0].map(String).join(" ");
  assert.equal(loggedText.includes(secretLookingPrompt), false, "the system prompt must never be logged");
  assert.equal(loggedText.includes("some partial answer text"), false, "streamed text/tool output must never be logged");
});

test("runAgentTurn: no timeout log occurs when the provider completes well within the budget", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  t.mock.module("./index", {
    namedExports: {
      getAIProvider: () => ({
        name: "fake",
        async *streamTurn() {
          yield { type: "text", text: "hi" };
          yield { type: "stop", reason: "end_turn" };
        },
      }),
    },
  });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await importFreshAgentRunner();

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "user-1", projectId: "project-1" },
    signal: new AbortController().signal,
    limits: { timeoutMs: 60_000 },
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text", text: "hi" },
    { type: "done", text: "hi" },
  ]);
  assert.equal(timeoutLogs(errorLogs).length, 0, "a successful turn must never log a timeout");
});
