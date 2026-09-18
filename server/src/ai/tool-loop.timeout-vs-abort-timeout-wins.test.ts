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

test("runChatTurn: when the timeout fires well before a scheduled-but-later caller abort, the timeout wins and throws", async (t) => {
  const { provider } = makeHangingProvider();

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const controller = new AbortController();
  // Scheduled well after the timeout fires - proves the timeout path and
  // an armed-but-not-yet-fired caller abort listener don't cross-contaminate.
  const laterAbort = setTimeout(() => controller.abort(), 500);
  t.after(() => clearTimeout(laterAbort));

  const { events, error } = await collect(
    runChatTurn({
      systemPrompt: "test",
      history: [{ role: "user", content: "hello" }],
      toolContext: { userId: "u1", projectId: "p1" },
      signal: controller.signal,
      timeoutMs: 20,
    }),
  );

  assert.deepEqual(events, []);
  assert.ok(error instanceof Error);
  assert.match((error as Error).message, /timed out/i);
});
