import { getAIProvider } from "./index";
import { AGENT_LIMITS, AI_LIMITS } from "./limits";
import {
  PROVIDER_TOOL_SPECS,
  buildAssistantBlocks,
  executeToolCall,
  extractDocumentSources,
  extractPendingAction,
  findTool,
  buildToolResultBlock,
  type DocumentSourceRef,
  type PendingActionRef,
} from "./tool-loop";
import type { ToolContext } from "./tools/types";
import { ProviderUnavailableError, type ProviderContentBlock, type ProviderMessage } from "./provider";

// Phase 15: a bounded, policy-only orchestration layer around the exact
// same AIProvider + shared tool-execution primitives runChatTurn already
// uses. AgentRunner never touches Prisma, never performs authorization
// itself, never accepts userId/projectId from model input, and never adds
// a tool - it only decides how many rounds/calls are allowed and for how
// long, then delegates everything else to what already exists.

export interface AgentLimits {
  maxRounds: number;
  maxToolCallsTotal: number;
  maxOutputTokens: number;
  maxToolResultChars: number;
  timeoutMs: number;
}

export interface RunAgentTurnParams {
  systemPrompt: string;
  history: ProviderMessage[]; // already includes the new user message
  toolContext: ToolContext;
  // Always the CALLER's (client) signal - the internal timeout controller
  // below is never exposed to callers.
  signal: AbortSignal;
  limits?: Partial<AgentLimits>;
}

// Only reasons actually emitted as an { type: "error" } event. Client
// abort is deliberately absent - it terminates the generator silently
// (no event at all), matching runChatTurn's existing abort semantics.
// "limit_reached" is deliberately absent - reaching a round/call limit is
// normal bounded completion (the final tools-disabled round still
// produces a `done`), not a failure. "provider_unavailable" (a provider's
// own transient availability/rate-limit failure surviving its own
// retry/backoff - see ProviderUnavailableError in ./provider) is
// distinguished from a generic "provider_error" so the client can be told
// specifically that the service is temporarily unavailable, not just that
// something went wrong.
export type AgentErrorReason = "timeout" | "provider_error" | "provider_unavailable";

export type AgentTurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "source"; sources: DocumentSourceRef[] }
  | { type: "pending_action"; pendingAction: PendingActionRef }
  | { type: "done"; text: string }
  | { type: "error"; reason: AgentErrorReason };

// Centralized so the four isTimedOut() yield sites below never duplicate
// this call - control flow guarantees at most one of them ever actually
// fires per turn (each is immediately followed by `return`), so this logs
// exactly once per real timeout, never more. Deliberately the only piece
// of context logged: projectId/userId (already-authenticated route
// params, not secrets - the same ids routinely appear in this codebase's
// own activity/notification records) and the configured timeout duration.
// Never the prompt, message history, or any provider/tool output, which
// could contain arbitrary user-authored content.
function logAgentTimeout(toolContext: ToolContext, timeoutMs: number): void {
  console.error(
    `Agent turn timed out after ${timeoutMs}ms (projectId=${toolContext.projectId}, userId=${toolContext.userId})`,
  );
}

function resolveLimits(overrides: Partial<AgentLimits> | undefined): AgentLimits {
  return {
    maxRounds: overrides?.maxRounds ?? AGENT_LIMITS.MAX_AGENT_ROUNDS,
    maxToolCallsTotal: overrides?.maxToolCallsTotal ?? AGENT_LIMITS.MAX_AGENT_TOOL_CALLS_TOTAL,
    // Output size and tool-result size are properties of a single provider
    // round/tool result, not of which orchestrator is calling - reuse
    // AI_LIMITS directly rather than duplicating a value.
    maxOutputTokens: overrides?.maxOutputTokens ?? AI_LIMITS.MAX_OUTPUT_TOKENS,
    maxToolResultChars: overrides?.maxToolResultChars ?? AI_LIMITS.MAX_TOOL_RESULT_CHARS,
    timeoutMs: overrides?.timeoutMs ?? AGENT_LIMITS.MAX_AGENT_TIMEOUT_MS,
  };
}

// Orchestrates a bounded, multi-round agent turn. Mirrors runChatTurn's
// shape closely on purpose (same kind of round loop, same shared
// primitives) but owns its own limits, its own termination policy, and a
// wall-clock timeout runChatTurn does not have.
export async function* runAgentTurn(params: RunAgentTurnParams): AsyncGenerator<AgentTurnEvent> {
  // Already gone before we even start - mirror runChatTurn's existing
  // already-aborted behavior exactly: zero provider calls, zero events.
  if (params.signal.aborted) return;

  const limits = resolveLimits(params.limits);

  // Unique per invocation - never confused with a sentinel from a
  // different, concurrent runAgentTurn call.
  const TIMEOUT_REASON = Symbol("agent-timeout");
  const internalController = new AbortController();

  // AbortController.abort() is first-writer-wins: once internalController
  // is aborted, every later .abort() call on it is a no-op and the first
  // call's reason sticks permanently. Because JS callbacks run one at a
  // time, "caller abort and timeout close together" reduces to "whichever
  // callback the event loop runs first" - there is no genuine race to
  // guard against beyond this, and no separate boolean flag is needed as
  // the source of truth.
  const onCallerAbort = () => {
    internalController.abort();
  };
  params.signal.addEventListener("abort", onCallerAbort);

  const timeoutHandle = setTimeout(() => {
    internalController.abort(TIMEOUT_REASON);
  }, limits.timeoutMs);

  const isTimedOut = () =>
    internalController.signal.aborted && internalController.signal.reason === TIMEOUT_REASON;

  try {
    const provider = getAIProvider();
    let messages = params.history;
    let toolCallCount = 0;
    let fullText = "";

    for (let round = 1; round <= limits.maxRounds; round++) {
      if (internalController.signal.aborted) {
        if (isTimedOut()) {
          logAgentTimeout(params.toolContext, limits.timeoutMs);
          yield { type: "error", reason: "timeout" };
        }
        return; // caller abort: silent, no done, no error
      }

      // The final configured round is always tool-free - this is what
      // makes stop_reason "tool_use" structurally impossible for it,
      // exactly like runChatTurn's own termination guarantee.
      const toolsAllowed = round < limits.maxRounds && toolCallCount < limits.maxToolCallsTotal;
      const toolSpecs = toolsAllowed ? PROVIDER_TOOL_SPECS : [];

      let roundText = "";
      const pendingToolUses: { id: string; name: string; input: unknown }[] = [];
      let stopReason = "end_turn";

      try {
        for await (const event of provider.streamTurn({
          systemPrompt: params.systemPrompt,
          messages,
          tools: toolSpecs,
          maxOutputTokens: limits.maxOutputTokens,
          signal: internalController.signal,
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
        if (internalController.signal.aborted) {
          if (isTimedOut()) {
            logAgentTimeout(params.toolContext, limits.timeoutMs);
            yield { type: "error", reason: "timeout" };
          }
          return; // caller abort: silent
        }
        // A genuine provider failure, unrelated to any abort - logged
        // server-side only; the event payload never carries the raw error.
        // A ProviderUnavailableError (the provider's own retry/backoff
        // already exhausted - see gemini.provider.ts) is logged and
        // reported the same way, just with a distinct reason so the
        // client-facing message can be more specific than the generic one.
        console.error("Agent turn: provider failure:", err instanceof Error ? err.message : err);
        yield { type: "error", reason: err instanceof ProviderUnavailableError ? "provider_unavailable" : "provider_error" };
        return;
      }

      messages = [...messages, { role: "assistant", content: buildAssistantBlocks(roundText, pendingToolUses) }];

      if (stopReason !== "tool_use" || pendingToolUses.length === 0) {
        yield { type: "done", text: fullText };
        return;
      }

      const resultBlocks: ProviderContentBlock[] = [];
      for (const use of pendingToolUses) {
        if (internalController.signal.aborted) {
          if (isTimedOut()) {
            logAgentTimeout(params.toolContext, limits.timeoutMs);
            yield { type: "error", reason: "timeout" };
          }
          return;
        }

        // Every pending tool_use gets a tool_call event regardless of
        // whether it will actually execute - keeps the event pairing
        // symmetric with the provider protocol's tool_use/tool_result
        // requirement, same as runChatTurn.
        yield { type: "tool_call", name: use.name, input: use.input };

        if (toolCallCount >= limits.maxToolCallsTotal) {
          resultBlocks.push({
            type: "tool_result",
            toolUseId: use.id,
            content: "Tool call limit reached for this message.",
            isError: true,
          });
          yield { type: "tool_result", name: use.name, ok: false };
          continue; // never executed - the cap is absolute
        }

        toolCallCount++;

        const tool = findTool(use.name);
        // executeToolCall already owns lookup-failure/argument-validation/
        // handler-failure redaction - AgentRunner never calls parseToolArgs
        // itself and never duplicates that handling.
        const executionResult = await executeToolCall(tool, use.input, params.toolContext);

        // Tool handlers do not accept an AbortSignal (ToolDefinition is
        // unchanged in this phase), so a timeout firing while the await
        // above was in flight cannot interrupt it - it's left to finish
        // naturally. This is the very next checkpoint after it resolves:
        // if a timeout landed during that call, stop now, before building
        // or yielding anything for this result and before any further
        // tool/round work.
        if (internalController.signal.aborted) {
          if (isTimedOut()) {
            logAgentTimeout(params.toolContext, limits.timeoutMs);
            yield { type: "error", reason: "timeout" };
          }
          return;
        }

        resultBlocks.push(buildToolResultBlock(use.id, executionResult, limits.maxToolResultChars));
        yield { type: "tool_result", name: use.name, ok: executionResult.ok };

        // Only after a successful call, never for a failed one, and never
        // an empty event when there's nothing to cite. Reuses the exact
        // same shared helper runChatTurn uses - no duplicated logic.
        const sources = extractDocumentSources(tool, executionResult);
        if (sources.length > 0) {
          yield { type: "source", sources };
        }

        // Same "only on success, never empty" rule as sources above, via
        // the exact same shared helper runChatTurn uses - no duplicated
        // extraction logic. Does not create a second PendingTaskAction row
        // or change anything about create-task.tool.ts's own proposal
        // semantics; this only surfaces, over SSE, the row that tool
        // already created.
        const pendingAction = extractPendingAction(tool, executionResult);
        if (pendingAction) {
          yield { type: "pending_action", pendingAction };
        }
      }

      messages = [...messages, { role: "user", content: resultBlocks }];
    }

    // Defensive-only: unreachable under correct configuration, since the
    // final permitted round is always tool-free and therefore always
    // returns via the `done` yield above. Same safety net runChatTurn has.
    yield { type: "done", text: fullText };
  } finally {
    clearTimeout(timeoutHandle);
    params.signal.removeEventListener("abort", onCallerAbort);
  }
}
