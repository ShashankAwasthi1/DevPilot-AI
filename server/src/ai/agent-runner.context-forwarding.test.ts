import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { makeScriptedProvider } from "./fixtures";

test("runAgentTurn: forwards toolContext into every tool handler exactly as given, never mutated or derived from tool input", async (t) => {
  const receivedContexts: unknown[] = [];
  const contextEchoTool = {
    name: "contextEchoTool",
    description: "test",
    schema: z.object({}).strict(),
    handler: async (_args: unknown, ctx: { userId: string; projectId: string }) => {
      receivedContexts.push(ctx);
      return { ok: true };
    },
  };

  const { provider } = makeScriptedProvider((callIndex) => {
    if (callIndex === 0) {
      return [
        { type: "tool_use", id: "c1", name: "contextEchoTool", input: {} },
        { type: "stop", reason: "tool_use" },
      ];
    }
    return [{ type: "text", text: "done" }, { type: "stop", reason: "end_turn" }];
  });

  t.mock.module("./index", { namedExports: { getAIProvider: () => provider } });
  t.mock.module("./tools", { namedExports: { TOOLS: [contextEchoTool] } });

  const { runAgentTurn } = await import("./agent-runner");

  const toolContext = { userId: "user-42", projectId: "project-7" };

  for await (const _event of runAgentTurn({
    systemPrompt: "test",
    history: [{ role: "user", content: "hello" }],
    toolContext,
    signal: new AbortController().signal,
  })) {
    // draining the generator
  }

  assert.equal(receivedContexts.length, 1);
  assert.deepEqual(receivedContexts[0], toolContext);
});
