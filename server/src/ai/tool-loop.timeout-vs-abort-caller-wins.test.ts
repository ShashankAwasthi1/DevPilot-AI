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

test("runChatTurn: when the caller aborts well before the timeout would fire, the abort wins and the run stays silent (no throw)", async (t) => {
  const { provider } = makeHangingProvider();

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runChatTurn } = await import("./tool-loop");

  const controller = new AbortController();
  const abortHandle = setTimeout(() => controller.abort(), 10);
  t.after(() => clearTimeout(abortHandle));

  const { events, error } = await collect(
    runChatTurn({
      systemPrompt: "test",
      history: [{ role: "user", content: "hello" }],
      toolContext: { userId: "u1", projectId: "p1" },
      signal: controller.signal,
      timeoutMs: 200,
    }),
  );

  assert.deepEqual(events, [], "a caller abort that genuinely happens first must never surface any event");
  assert.equal(error, undefined, "a genuine caller disconnect must return silently, never throw");
});
