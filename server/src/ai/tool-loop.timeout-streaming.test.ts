import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeHangingProvider } from "./fixtures";
import type { TurnEvent } from "./tool-loop";

const echoTool = {
  name: "echoTool",
  description: "test tool",
  schema: z.object({}).strict(),
  handler: async () => ({ ok: true }),
};

async function collect(gen: AsyncGenerator<TurnEvent>): Promise<{ events: TurnEvent[]; error: unknown }> {
  const events: TurnEvent[] = [];
  let error: unknown;
  try {
    for await (const event of gen) {
      events.push(event);
    }
  } catch (err) {
    error = err;
  }
  return { events, error };
}

test("runChatTurn: a timeout that fires mid-stream keeps the partial text already yielded, then throws", async (t) => {
  const { provider } = makeHangingProvider({ textBeforeHang: "partial answer" });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const { events, error } = await collect(
    runChatTurn({
      systemPrompt: "test",
      history: [{ role: "user", content: "hello" }],
      toolContext: { userId: "u1", projectId: "p1" },
      signal: new AbortController().signal,
      timeoutMs: 30,
    }),
  );

  // The already-streamed text event must never be lost/rolled back just
  // because the turn ultimately times out - the client already received
  // it over SSE by the time the timeout fires.
  assert.deepEqual(events, [{ type: "text", text: "partial answer" }]);
  assert.ok(error instanceof Error);
  assert.match((error as Error).message, /timed out/i);
});
