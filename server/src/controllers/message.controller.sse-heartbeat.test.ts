import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeRequest, makeFakeResponse, throwingNext, eventsFrom } from "./test-helpers";

// Phase 16D (B3): a lightweight SSE keepalive comment (":\n\n") written
// roughly every 15s while a turn is active, so an idle-connection timeout
// on a proxy between the browser and this server never severs a long,
// output-quiet tool-calling round before the AI turn's own 60s timeout
// gets a chance to fire.

let importCounter = 0;
function importFreshController() {
  return import(`./message.controller?test=${importCounter++}`) as Promise<
    typeof import("./message.controller")
  >;
}

// Flushes enough microtask ticks for postMessage's own setup awaits
// (assertConversationWritable, appendMessage, buildProjectContext,
// listRecentHistory - each a mocked, immediately-resolving async
// function, awaited sequentially before the heartbeat interval is even
// scheduled) to fully settle, so a subsequent `t.mock.timers.tick(...)`
// reliably lands after the interval already exists.
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function mockCommonServices(t: import("node:test").TestContext) {
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
}

test("postMessage: emits an SSE heartbeat comment during a long-running turn, distinct from every application event", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockCommonServices(t);

  let releaseTurn: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  // A turn that hangs (awaiting an externally-controlled gate) before
  // yielding anything - models a long tool-calling round with no text/
  // tool output yet, exactly the case a heartbeat exists for.
  async function* slowTurn() {
    await gate;
    yield { type: "text" as const, text: "answer" };
    yield { type: "done" as const, text: "answer" };
  }
  t.mock.module("../ai/tool-loop", { namedExports: { runChatTurn: () => slowTurn() } });

  const { postMessage } = await importFreshController();
  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  const done = postMessage(req, res, throwingNext());

  // Let postMessage run synchronously up to its `await gate` inside
  // slowTurn - by then the heartbeat interval has already been scheduled.
  await flushMicrotasks();

  assert.equal(state.writes.filter((w) => w === ":\n\n").length, 0, "no heartbeat before the first interval tick");

  t.mock.timers.tick(15000);
  assert.equal(state.writes.filter((w) => w === ":\n\n").length, 1, "one heartbeat after 15s");

  t.mock.timers.tick(15000);
  assert.equal(state.writes.filter((w) => w === ":\n\n").length, 2, "a second heartbeat after another 15s");

  // No heartbeat write is ever framed as event:/data: - it must never be
  // mistakeable for an application event by the frontend's SSE parser.
  assert.ok(
    state.writes.filter((w) => w === ":\n\n").every((w) => !w.startsWith("event:") && !w.startsWith("data:")),
    "a heartbeat must be a bare comment line, never event:/data: framed",
  );

  releaseTurn();
  await done;

  assert.ok(state.writes.some((w) => w.startsWith("event: done")), "the turn must still complete normally");
});

test("postMessage: a heartbeat comment never appears as, or alongside, an application SSE event type", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockCommonServices(t);

  let releaseTurn: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  async function* slowTurn() {
    await gate;
    yield { type: "done" as const, text: "answer" };
  }
  t.mock.module("../ai/tool-loop", { namedExports: { runChatTurn: () => slowTurn() } });

  const { postMessage } = await importFreshController();
  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  const done = postMessage(req, res, throwingNext());
  await flushMicrotasks();
  t.mock.timers.tick(15000);

  const heartbeats = state.writes.filter((w) => w === ":\n\n");
  assert.equal(heartbeats.length, 1);
  // No JSON.parse-able payload, no "event: heartbeat" framing of any kind
  // exists anywhere in what was written so far.
  assert.ok(!state.writes.some((w) => w.includes("heartbeat")), "the wire format must never name a heartbeat event type");

  releaseTurn();
  await done;
});

test("postMessage: the heartbeat timer is cleared on successful completion - no further heartbeat writes after done", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockCommonServices(t);

  t.mock.module("../ai/tool-loop", {
    namedExports: { runChatTurn: () => eventsFrom([{ type: "done", text: "ok" }]) },
  });

  const { postMessage } = await importFreshController();
  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());
  const before = state.writes.filter((w) => w === ":\n\n").length;

  // If the timer were still live, ticking well past several intervals
  // would append more heartbeat writes - it must not, since the response
  // has already ended.
  t.mock.timers.tick(60000);

  assert.equal(
    state.writes.filter((w) => w === ":\n\n").length,
    before,
    "no heartbeat write may occur after the response has already ended",
  );
});

test("postMessage: the heartbeat timer is cleared after a provider error (chat mode's thrown-error path)", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockCommonServices(t);

  t.mock.module("../ai/tool-loop", {
    namedExports: {
      runChatTurn: async function* () {
        throw new Error("some provider failure");
      },
    },
  });

  const { postMessage } = await importFreshController();
  const { req } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  await postMessage(req, res, throwingNext());
  assert.ok(state.writes.some((w) => w.startsWith("event: error")));

  const before = state.writes.filter((w) => w === ":\n\n").length;
  t.mock.timers.tick(60000);

  assert.equal(
    state.writes.filter((w) => w === ":\n\n").length,
    before,
    "no heartbeat write may occur after an error has already ended the response",
  );
});

test("postMessage: the heartbeat timer is cleared immediately on client disconnect, never writing to the closed response again", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockCommonServices(t);

  let releaseTurn: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  async function* hangingTurn() {
    await gate;
    yield { type: "done" as const, text: "unreachable" };
  }
  t.mock.module("../ai/tool-loop", { namedExports: { runChatTurn: () => hangingTurn() } });

  const { postMessage } = await importFreshController();
  const { req, triggerClose } = makeFakeRequest({
    projectId: "p1",
    conversationId: "c1",
    userId: "u1",
    body: { content: "hi", mode: "chat" },
  });
  const { res, state } = makeFakeResponse();

  const done = postMessage(req, res, throwingNext());
  await flushMicrotasks();

  t.mock.timers.tick(15000);
  const afterOneHeartbeat = state.writes.filter((w) => w === ":\n\n").length;
  assert.equal(afterOneHeartbeat, 1);

  // Client disconnects mid-turn - req.on("close") must stop the heartbeat
  // immediately, not wait for the turn's own eventual abort handling.
  triggerClose();

  t.mock.timers.tick(60000);
  assert.equal(
    state.writes.filter((w) => w === ":\n\n").length,
    afterOneHeartbeat,
    "no further heartbeat write after the client has disconnected",
  );

  // Let the hung turn's gate resolve so the test doesn't leave a dangling
  // unresolved generator behind; postMessage's own abort-handling settles
  // the promise regardless (see message.controller.agent-client-abort.test.ts
  // for the equivalent existing coverage of the abort path itself).
  releaseTurn();
  await done;
});
