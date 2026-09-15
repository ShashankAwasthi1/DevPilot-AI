import { z } from "zod";
import { getAIProvider } from "./index";
import { AI_LIMITS } from "./limits";
import { TOOLS } from "./tools";
import type { ToolContext, ToolDefinition } from "./tools/types";
import type { ProviderContentBlock, ProviderMessage, ProviderToolSpec } from "./provider";

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done"; text: string };

// Computed once, not per round - the tool set is fixed and small. Exported
// (Phase 15 Step 4) so agent-runner.ts's own round loop can offer the exact
// same tool specs without recomputing them.
export const PROVIDER_TOOL_SPECS: ProviderToolSpec[] = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.schema) as Record<string, unknown>,
}));

// --- Shared per-call tool execution primitives ---------------------------
//
// These are extracted (Phase 15 Step 2a) so a future AgentRunner can reuse
// exactly the same tool-call mechanics runChatTurn already relies on and
// already has tests for. Deliberately NOT extracted: round/call-count
// policy (offering tools, the round loop, the MAX_TOOL_CALLS_TOTAL cap) -
// that orchestration stays in runChatTurn below, since it's precisely what
// must differ between an ordinary chat turn and an agent turn. Each
// primitive here represents the execution of one already-selected tool
// call, nothing about how many calls are allowed.

// Pure lookup of a tool by name from the existing TOOLS registry.
export function findTool(name: string): ToolDefinition<any> | undefined {
  return TOOLS.find((t) => t.name === name);
}

// Validates model-provided tool input against the tool's own (already
// .strict()) Zod schema. Throws (ZodError) on invalid input, exactly as
// `tool.schema.parse` already does - callers are responsible for handling
// that, matching the previous inline behavior.
export function parseToolArgs(tool: ToolDefinition<any>, input: unknown): unknown {
  return tool.schema.parse(input);
}

export type ToolExecutionResult = { ok: true; result: unknown } | { ok: false };

// Executes ONE already-selected tool call: unknown tool, malformed
// arguments, and any handler failure (including an access-check AppError)
// all collapse to the same safe, non-throwing `{ ok: false }` outcome -
// this function never rejects and never leaks internal error details to
// its caller. Orchestration concerns (whether this call is allowed to run
// at all, i.e. the total-call cap) are the caller's responsibility, not
// this primitive's - it always executes what it's given.
export async function executeToolCall(
  tool: ToolDefinition<any> | undefined,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  try {
    if (!tool) throw new Error("Unknown tool"); // unknown tool
    const args = parseToolArgs(tool, input); // malformed arguments
    const result = await tool.handler(args, ctx); // auth failure / execution failure
    return { ok: true, result };
  } catch {
    // Unknown tool, malformed args, an AppError from an access check, or
    // any other execution failure all collapse here - never leak internal
    // error text into the model's context.
    return { ok: false };
  }
}

// Never blindly slices a serialized JSON string - that can cut mid-object
// and hand the model malformed/misleading structured data. For the
// array-shaped results every current tool returns, trailing elements are
// dropped until the (always fully valid) JSON fits. For anything else, a
// small honest "truncated" marker object is returned instead of a broken
// fragment.
function boundToolResult(result: unknown, maxChars: number): string {
  const full = JSON.stringify(result);
  if (full.length <= maxChars) return full;

  if (Array.isArray(result)) {
    let items = result;
    while (items.length > 0) {
      items = items.slice(0, -1);
      const candidate = JSON.stringify(items);
      if (candidate.length <= maxChars) return candidate;
    }
    return JSON.stringify([]);
  }

  return JSON.stringify({ truncated: true, note: "Result too large to include in full." });
}

// Converts one executeToolCall outcome into the exact `tool_result`
// content block shape runChatTurn has always produced: bounded JSON on
// success, or the fixed, safe error string on failure. The fixed string
// below must stay byte-identical - it's the one guarantee that no internal
// error detail ever reaches the model.
export function buildToolResultBlock(
  toolUseId: string,
  executionResult: ToolExecutionResult,
  maxChars: number,
): ProviderContentBlock {
  if (executionResult.ok) {
    return {
      type: "tool_result",
      toolUseId,
      content: boundToolResult(executionResult.result, maxChars),
    };
  }
  return {
    type: "tool_result",
    toolUseId,
    content: "This tool call could not be completed.",
    isError: true,
  };
}

// Exported (Phase 15 Step 4) so agent-runner.ts can reuse it unchanged.
export function buildAssistantBlocks(
  text: string,
  toolUses: { id: string; name: string; input: unknown }[],
): ProviderContentBlock[] {
  const blocks: ProviderContentBlock[] = [];
  if (text.length > 0) blocks.push({ type: "text", text });
  for (const use of toolUses) {
    blocks.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
  }
  return blocks;
}

export interface RunChatTurnParams {
  systemPrompt: string;
  history: ProviderMessage[]; // already includes the new user message
  toolContext: ToolContext;
  signal: AbortSignal;
}

// Orchestrates however many provider round-trips one user message needs.
// MAX_TOOL_ROUNDS is the absolute maximum number of provider.streamTurn()
// calls made here - not "rounds with tools" plus an implicit extra. The
// final permitted round always has tools disabled, which makes
// stop_reason:"tool_use" structurally impossible for it (the model has
// nothing to call) - that is what guarantees this loop terminates, not a
// heuristic.
export async function* runChatTurn(params: RunChatTurnParams): AsyncGenerator<TurnEvent> {
  const provider = getAIProvider();
  let messages = params.history;
  let toolCallCount = 0;
  let fullText = "";

  for (let round = 1; round <= AI_LIMITS.MAX_TOOL_ROUNDS; round++) {
    if (params.signal.aborted) return;

    const offerTools = round < AI_LIMITS.MAX_TOOL_ROUNDS && toolCallCount < AI_LIMITS.MAX_TOOL_CALLS_TOTAL;
    const toolSpecs = offerTools ? PROVIDER_TOOL_SPECS : [];

    let roundText = "";
    const pendingToolUses: { id: string; name: string; input: unknown }[] = [];
    let stopReason = "end_turn";

    try {
      for await (const event of provider.streamTurn({
        systemPrompt: params.systemPrompt,
        messages,
        tools: toolSpecs,
        maxOutputTokens: AI_LIMITS.MAX_OUTPUT_TOKENS,
        signal: params.signal,
      })) {
        if (event.type === "text") {
          roundText += event.text;
          fullText += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "tool_use") {
          pendingToolUses.push(event);
        } else if (event.type === "stop") {
          stopReason = event.reason;
        }
      }
    } catch (err) {
      // AbortSignal cancellation mid-provider-call: stop silently, nothing
      // left to report. Anything else is a genuine provider failure -
      // re-throw so message.controller.ts's existing SSE error handling
      // (unchanged from Phase 12) writes `event: error` exactly as before.
      if (params.signal.aborted) return;
      throw err;
    }

    messages = [...messages, { role: "assistant", content: buildAssistantBlocks(roundText, pendingToolUses) }];

    if (stopReason !== "tool_use" || pendingToolUses.length === 0) {
      yield { type: "done", text: fullText };
      return;
    }

    // Anthropic requires a tool_result for every tool_use block in the
    // round, even ones this loop refuses to execute - so the total-call cap
    // is enforced per block, here, never by omitting a result.
    const resultBlocks: ProviderContentBlock[] = [];
    for (const use of pendingToolUses) {
      if (params.signal.aborted) return; // don't start further tool work post-disconnect

      // Every pending tool_use gets a tool_call event, regardless of
      // whether it will actually run - keeps the SSE tool_call/tool_result
      // pairing symmetric (one of each per tool_use block the model asked
      // for), matching the Anthropic-side guarantee that every tool_use
      // gets a tool_result.
      yield { type: "tool_call", name: use.name, input: use.input };

      if (toolCallCount >= AI_LIMITS.MAX_TOOL_CALLS_TOTAL) {
        resultBlocks.push({
          type: "tool_result",
          toolUseId: use.id,
          content: "Tool call limit reached for this message.",
          isError: true,
        });
        yield { type: "tool_result", name: use.name, ok: false };
        continue; // never executed - the cap is absolute, not per-round
      }

      toolCallCount++;

      const tool = findTool(use.name);
      const executionResult = await executeToolCall(tool, use.input, params.toolContext);
      resultBlocks.push(buildToolResultBlock(use.id, executionResult, AI_LIMITS.MAX_TOOL_RESULT_CHARS));
      yield { type: "tool_result", name: use.name, ok: executionResult.ok };
    }

    messages = [...messages, { role: "user", content: resultBlocks }];
  }

  // Defensive-only: unreachable under correct configuration, since the
  // final permitted round always has tools disabled and therefore always
  // returns via the `done` yield inside the loop above. Kept as a safety
  // net so this generator can never fail to terminate even under a
  // degenerate MAX_TOOL_ROUNDS misconfiguration.
  yield { type: "done", text: fullText };
}
