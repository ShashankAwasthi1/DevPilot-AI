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

test("runChatTurn: a provider call that never resolves is stopped by the timeout, throwing before any output", async (t) => {
  const { provider } = makeHangingProvider();

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

  assert.deepEqual(events, [], "no output was ever produced before the timeout fired");
  assert.ok(error instanceof Error, "a timeout must surface as a thrown error, not a silent return");
  assert.match((error as Error).message, /timed out/i);
});
