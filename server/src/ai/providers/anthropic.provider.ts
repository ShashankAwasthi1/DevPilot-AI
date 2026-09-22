import type Anthropic from "@anthropic-ai/sdk";
import { getAIConfig } from "../../config/ai";
import {
  ProviderUnavailableError,
  type AIProvider,
  type ProviderContentBlock,
  type ProviderMessage,
  type StreamEvent,
  type StreamTurnParams,
} from "../provider";

// The only file in the codebase allowed to import the Anthropic SDK -
// everything else depends on the AIProvider interface only, so adding a
// second provider later never touches a controller, service, or the
// tool-loop orchestrator.
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  async *streamTurn(params: StreamTurnParams): AsyncGenerator<StreamEvent> {
    const config = getAIConfig();
    // getAIProvider() (ai/index.ts) only ever constructs this class when
    // AI_PROVIDER selected "anthropic", so this branch is always true in
    // practice - the check exists purely so TypeScript can narrow
    // AIConfig's discriminated union to the "anthropic" member below,
    // since getAIConfig() is called fresh here rather than passed in.
    if (config.provider !== "anthropic") {
      throw new Error("AnthropicProvider invoked while AI_PROVIDER is not \"anthropic\"");
    }

    // Dynamic import rather than a static top-level one - needed so this
    // SDK's construction/error classes can be mocked per-test the same
    // way local-embedding-provider.ts's own @xenova/transformers import
    // already is: a static top-level import of an external package is
    // resolved once when the module is first linked, before this
    // codebase's per-test module-mocking hook ever gets a chance to
    // intercept it for a freshly re-imported copy of this file, so it
    // would otherwise always hit the real network in tests regardless of
    // any mock. Cheap after the first call in real use - ESM caches the
    // resolved module, so this never re-downloads/reinitializes anything
    // per round of a turn.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const stream = client.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: params.maxOutputTokens,
        system: params.systemPrompt,
        messages: params.messages.map(toAnthropicMessage),
        // Omitted entirely (not sent as []) when no tools are offered this
        // round - this is what makes it structurally impossible for the
        // model to return a tool_use block on a tool-free round.
        ...(params.tools.length > 0
          ? {
              tools: params.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      { signal: params.signal },
    );

    // Phase 16D (C3): the Anthropic SDK already retries 408/409/429/5xx
    // (and connection-level timeouts) internally, with its own bounded
    // backoff, entirely before client.messages.stream() above ever hands
    // back an iterable/finalMessage() to wait on - exactly like
    // gemini.provider.ts's own pre-first-byte retry. This try/catch never
    // adds a second retry layer; it only runs once, after the SDK has
    // already given up, to reclassify the ONE final error it threw -
    // never to retry the request again. Wrapping the entire body
    // (iteration through the final `stop` yield) means any error here -
    // whether raised mid-iteration after text/tool events were already
    // yielded, or from finalMessage() itself - always propagates as a
    // thrown exception and the `stop` yield below is simply never
    // reached; there is no path back to a successful completion once this
    // catch fires.
    try {
      // Real-time text deltas as they arrive, for live streaming to the
      // client - the low-level async-iterable gives us this without
      // waiting for the whole turn to finish.
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }

      // finalMessage() resolves from the same already-completed request
      // (the iteration above has already fully drained the stream) and
      // gives us fully-parsed content blocks - including complete
      // tool_use blocks with already-parsed `input` - instead of
      // hand-accumulating input_json_delta fragments ourselves.
      const finalMessage = await stream.finalMessage();

      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          yield { type: "tool_use", id: block.id, name: block.name, input: block.input };
        }
      }

      yield { type: "stop", reason: finalMessage.stop_reason ?? "end_turn" };
    } catch (err) {
      throw classifyAnthropicError(err, Anthropic.APIError);
    }
  }
}

// A real mid-stream in-band SSE `event: error` frame (as opposed to a
// pre-stream HTTP failure) is converted by the SDK into an APIError with
// `status: undefined` - there was never an HTTP status line for it, only
// this `type` string (see APIError.generate in the SDK, which reads
// `error?.error?.type` off the frame's own body). These two values are
// Anthropic's own documented names for exactly the transient conditions
// this codebase already treats as retryable by status code elsewhere
// (rate limiting and provider-side overload) - deliberately an exact,
// narrow allowlist, never a catch-all, so an unrecognized/new error type
// is never guessed at and stays a plain, generic failure.
const TRANSIENT_ANTHROPIC_ERROR_TYPES = new Set(["rate_limit_error", "overloaded_error"]);

// The SDK's own shouldRetry() already treats 429 and every 5xx as
// transient and retries them before giving up - this mirrors that exact
// same status-based judgment, once, on whatever error survives that
// retry policy, so the client gets the same distinct "temporarily
// unavailable" message gemini.provider.ts's own 503/429 handling already
// produces for the structurally equivalent condition. The `type`-based
// check above covers the one case status alone can't: a mid-stream
// in-band error frame, which never carries a numeric status at all.
// Every other error - a permanent 4xx (400/401/403/404/422), a
// network-level APIConnectionError/APIConnectionTimeoutError (no status
// and no `type` - the request never got a response to classify at all),
// an abort, an unrecognized `type` string, or anything not even shaped
// like an Anthropic.APIError - is returned completely unchanged. Reads
// only `err.status`, `err.type`, and `err.message` (already a redacted,
// provider-composed string - see APIError.makeMessage in the SDK - never
// the raw response body/headers, and never anything containing the
// request's own Authorization/x-api-key header, which isn't part of a
// response-side error object to begin with).
function classifyAnthropicError(err: unknown, APIError: typeof Anthropic.APIError): unknown {
  if (!(err instanceof APIError)) {
    return err;
  }

  const isRetryableStatus = typeof err.status === "number" && (err.status === 429 || err.status >= 500);
  const isKnownTransientType = typeof err.type === "string" && TRANSIENT_ANTHROPIC_ERROR_TYPES.has(err.type);

  if (isRetryableStatus || isKnownTransientType) {
    return new ProviderUnavailableError(err.message);
  }
  return err;
}

function toAnthropicMessage(message: ProviderMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(block: ProviderContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}
