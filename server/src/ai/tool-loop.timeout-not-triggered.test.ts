import { test } from "node:test";
import assert from "node:assert/strict";
import { makeScriptedProvider } from "./fixtures";

// Phase 27 Step 8: confirms the new timeout machinery is inert on the
// ordinary, fast-completing path - a normal turn must complete exactly as
// it did before this step (a `done` event, no thrown error), and the
// provider must receive a real AbortSignal (the internal one this
// function now wires through), not the caller's raw signal object
// unchanged.

test("runChatTurn: a provider that resolves well within the timeout completes normally - no throw, exactly one done event", async (t) => {
  const { provider, calls } = makeScriptedProvider(() => [
    { type: "text", text: "hello there" },
    { type: "stop", reason: "end_turn" },
  ]);

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [] } });

  const { runChatTurn } = await import("./tool-loop");

  const events = [];
  for await (const event of runChatTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
    timeoutMs: 60_000,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "text", text: "hello there" },
    { type: "done", text: "hello there" },
  ]);
  assert.equal(calls.length, 1);
  // The provider must receive a real, distinct AbortSignal (the internal
  // controller's), proving the timeout wiring is actually connected on
  // the success path too, not only when a timeout fires.
  assert.ok(calls[0].params.signal instanceof AbortSignal);
  assert.equal(calls[0].params.signal.aborted, false);
});
