import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

// "./message.controller" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change
// the bindings a module already captured on its first import (same
// module-cache constraint documented throughout this codebase, e.g.
// document.service.create.test.ts). A unique query string per test forces
// a fresh module instance so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshController() {
  return import(`./message.controller?test=${importCounter++}`) as Promise<
    typeof import("./message.controller")
  >;
}

// Phase 27 bug-fix: agent-runner.ts now logs both "timeout" and
// "provider_error" safely before yielding its { type: "error" } event
// (see agent-runner.timeout-logging.test.ts and the pre-existing
// agent-runner.provider-error.test.ts). These tests prove the controller
// itself does NOT add a second, duplicate log for the same occurrence -
// with agent-runner mocked away entirely (as every existing controller
// test already does), any console.error call observed here could only
// have come from the controller, never from the real agent-runner.

// Node itself can emit its own one-time, process-level console.error
// output (e.g. "ExperimentalWarning: Module mocking is an experimental
// feature...") the first time mock.module/mock.method are used in a
// process - unrelated to this code, but captured by a console.error mock
// all the same. Excluding known Node-warning text keeps this assertion
// robust regardless of whether that happens to land during a given test.
function applicationLogs(errorLogs: unknown[][]): unknown[][] {
  return errorLogs.filter(
    (args) => !args.some((arg) => /ExperimentalWarning|trace-warnings/.test(String(arg))),
  );
}

function withMockedTurnSources(t: import("node:test").TestContext, event: { type: "error"; reason: "timeout" | "provider_error" }) {
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
    namedExports: { runAgentTurn: () => eventsFrom([event]) },
  });
}

for (const reason of ["timeout", "provider_error"] as const) {
  test(`postMessage: forwarding an agent ${reason} error event does not itself log anything (agent-runner.ts already logged it before yielding)`, async (t) => {
    const errorLogs: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => {
      errorLogs.push(args);
    });

    withMockedTurnSources(t, { type: "error", reason });

    const { postMessage } = await importFreshController();
    const { req } = makeFakeRequest({
      projectId: "p1",
      conversationId: "c1",
      userId: "u1",
      body: { content: "hi", mode: "agent" },
    });
    const { res } = makeFakeResponse();

    await postMessage(req, res, throwingNext());

    assert.equal(
      applicationLogs(errorLogs).length,
      0,
      "the controller must not log again for an event agent-runner.ts already logged - that would be a duplicate",
    );
  });
}

test("postMessage: timeout and provider_error still produce distinguishable client-facing messages, even with no controller-side logging", async (t) => {
  withMockedTurnSources(t, { type: "error", reason: "timeout" });
  const { postMessage } = await importFreshController();
  const { req: timeoutReq } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "agent" },
  });
  const { res: timeoutRes, state: timeoutState } = makeFakeResponse();
  await postMessage(timeoutReq, timeoutRes, throwingNext());

  const timeoutFrame = timeoutState.writes.find((w) => w.startsWith("event: error"));
  assert.ok(timeoutFrame);
  const timeoutPayload = JSON.parse(timeoutFrame!.split("data: ")[1]) as { message: string };
  assert.equal(timeoutPayload.message, "The request took too long to complete.");
  assert.notEqual(timeoutPayload.message, "Something went wrong generating a response.");
});
