import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ProviderUnavailableError } from "./provider";

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

test("runAgentTurn: a ProviderUnavailableError (provider's own retry/backoff already exhausted) yields reason 'provider_unavailable', distinct from a generic provider_error", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  const provider = {
    name: "fake",
    async *streamTurn() {
      throw new ProviderUnavailableError("Gemini API returned 503: This model is currently experiencing high demand.");
    },
  };

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await importFreshAgentRunner();

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "error", reason: "provider_unavailable" }]);
  assert.ok(
    errorLogs.some((args) => args.some((a) => String(a).includes("provider failure"))),
    "a provider_unavailable failure must still be logged server-side, same as any other provider failure",
  );
});

test("runAgentTurn: a plain (non-ProviderUnavailableError) provider failure still yields the generic 'provider_error' reason, unchanged", async (t) => {
  t.mock.method(console, "error", () => {});

  const provider = {
    name: "fake",
    async *streamTurn() {
      throw new Error("some other genuine failure");
    },
  };

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [echoTool] } });

  const { runAgentTurn } = await importFreshAgentRunner();

  const events = [];
  for await (const event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext: { userId: "u1", projectId: "p1" },
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ type: "error", reason: "provider_error" }]);
});
