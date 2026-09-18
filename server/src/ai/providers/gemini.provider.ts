import { getAIConfig } from "../../config/ai";
import {
  ProviderUnavailableError,
  type AIProvider,
  type ProviderContentBlock,
  type ProviderMessage,
  type ProviderToolSpec,
  type StreamEvent,
  type StreamTurnParams,
} from "../provider";

// Plain fetch against Gemini's REST streaming endpoint, not an SDK -
// matches this project's existing "no unnecessary dependencies" pattern:
// prefer a hand-rolled client over pulling in an SDK whose surface area
// would mostly go unused. Gemini's streamGenerateContent + alt=sse gives a
// plain Server-Sent-Events body, which is straightforward to parse by
// hand - no client library needed.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini intermittently returns 503 UNAVAILABLE ("high demand") or 429
// RESOURCE_EXHAUSTED (rate limiting) - both genuinely transient, and a
// fresh identical request often succeeds within seconds. Retried here,
// before streamTurn ever yields a single event to its caller (see
// fetchGeminiResponseWithRetry below) - once an event has been yielded,
// this function has already returned and streamTurn moves on to reading/
// yielding the live stream, where a failure is never retried, since
// restarting the request at that point would duplicate already-streamed
// output. Every other status (auth, invalid request, not-found, and any
// other permanent failure) is never retried - see isRetryableGeminiStatus.
const MAX_GEMINI_RETRY_ATTEMPTS = 2;
const INITIAL_RETRY_BACKOFF_MS = 500;

function isRetryableGeminiStatus(status: number): boolean {
  return status === 503 || status === 429;
}

// No jitter: this codebase has no existing retry/backoff convention to
// match, and a fixed, deterministic backoff keeps this both simple and
// easy to test precisely - worth revisiting only if real-world retry
// clustering ever becomes an observed problem at this app's scale.
function retryBackoffMs(attempt: number): number {
  return INITIAL_RETRY_BACKOFF_MS * 2 ** (attempt - 1);
}

// Resolves after `ms`, unless `signal` fires first - in which case it
// rejects immediately with the same AbortError shape a real aborted fetch
// would produce, so a caller disconnecting mid-backoff stops the retry
// loop right away instead of completing the wait first.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("This operation was aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("This operation was aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Performs the request, retrying only a transient availability/rate-limit
// status (see isRetryableGeminiStatus) with a small bounded exponential
// backoff. Every other outcome - success, a non-retryable status, a
// retryable status with no attempts left, or a network-level failure -
// resolves/rejects exactly as the original unretried implementation did,
// so existing error-message/redaction behavior for those cases is
// unchanged.
async function fetchGeminiResponseWithRetry(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  let attempt = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Never surface the underlying network error object here - keep the
      // message fixed and generic. tool-loop.ts/agent-runner.ts only ever
      // check `signal.aborted` in their catch blocks (not this error's
      // identity), so wrapping an abort-triggered rejection in a generic
      // message here is still handled correctly as a silent cancellation
      // by the caller.
      throw new Error("Could not reach the Gemini API.", { cause: err });
    }

    if (response.ok && response.body) {
      return response;
    }

    if (isRetryableGeminiStatus(response.status) && attempt < MAX_GEMINI_RETRY_ATTEMPTS) {
      attempt++;
      const backoffMs = retryBackoffMs(attempt);
      // Safe: provider name, HTTP status, attempt count, and backoff
      // duration only - never the response body (which could be
      // arbitrarily long/detailed), never any header, never the API key.
      console.error(
        `Gemini provider: received HTTP ${response.status} - retrying (attempt ${attempt}/${MAX_GEMINI_RETRY_ATTEMPTS}) in ${backoffMs}ms`,
      );
      await delay(backoffMs, signal);
      continue;
    }

    const bodyText = await safeReadBody(response, apiKey);
    const message = `Gemini API returned ${response.status}: ${bodyText}`;
    // Distinguishes "the provider is transiently unavailable, even after
    // retrying" from every other failure, so agent-runner.ts/
    // message.controller.ts can surface a more specific, still-safe
    // message instead of the fully generic one - see ProviderUnavailableError's
    // own doc comment in ../provider.ts.
    if (isRetryableGeminiStatus(response.status)) {
      throw new ProviderUnavailableError(message);
    }
    throw new Error(message);
  }
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  // Gemini 3's "thinking" models attach this to a functionCall part they
  // return, and require the exact same value to be sent back on that same
  // functionCall part in the next request (see the class-level comment on
  // GeminiProvider#thoughtSignatures for how this codebase carries it
  // through). Never generated, guessed, or derived here - only ever
  // copied verbatim from what Gemini itself returned.
  thoughtSignature?: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiStreamChunk {
  candidates?: {
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }[];
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  // Gemini 3 "thinking" models require a functionCall's thoughtSignature
  // (opaque, provider-issued - never invented/hashed/decoded here) to be
  // echoed back verbatim on that exact functionCall part in the request
  // that carries its functionResponse; omitting it is a 400 ("Function
  // call is missing a thought_signature..."). ProviderContentBlock's
  // tool_use/tool_result shape has no field for this (Anthropic has no
  // equivalent concept), so rather than widen that shared type - and
  // tool-loop.ts/agent-runner.ts along with it - for a single provider's
  // quirk, this is tracked entirely inside this class, keyed by the same
  // synthesized tool_use id already used for StreamEvent. getAIProvider()
  // (ai/index.ts) constructs a fresh GeminiProvider per turn and
  // runChatTurn/runAgentTurn each call getAIProvider() exactly once,
  // reusing that one instance across every round of the turn - precisely
  // the lifetime needed for a signature to survive from the round that
  // received it to the round that sends its result back, without leaking
  // between unrelated turns/conversations (a fresh instance means a fresh,
  // empty map every turn).
  #thoughtSignatures = new Map<string, string>();

  async *streamTurn(params: StreamTurnParams): AsyncGenerator<StreamEvent> {
    const config = getAIConfig();
    // getAIProvider() (ai/index.ts) only ever constructs this class when
    // AI_PROVIDER selected "gemini" - see anthropic.provider.ts's
    // identical guard/comment for why this check exists (TypeScript
    // narrowing of AIConfig's discriminated union, not a real runtime
    // possibility).
    if (config.provider !== "gemini") {
      throw new Error("GeminiProvider invoked while AI_PROVIDER is not \"gemini\"");
    }

    // Tool results (ProviderContentBlock's tool_result) carry a
    // toolUseId, never the tool's name - Anthropic matches purely by id,
    // but Gemini's functionResponse part requires the function `name`
    // instead (it has no call-id concept at all). This index recovers
    // the name for every tool_use id that appears anywhere in this
    // turn's history, built once per call.
    const toolNameById = buildToolUseNameIndex(params.messages);

    const body: Record<string, unknown> = {
      contents: params.messages.map((message) =>
        toGeminiContent(message, toolNameById, this.#thoughtSignatures),
      ),
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      generationConfig: { maxOutputTokens: params.maxOutputTokens },
    };
    if (params.tools.length > 0) {
      body.tools = [{ functionDeclarations: params.tools.map(toGeminiFunctionDeclaration) }];
    }

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(config.geminiModel)}:streamGenerateContent?alt=sse`;

    const response = await fetchGeminiResponseWithRetry(url, body, config.geminiApiKey, params.signal);

    let callIndex = 0;
    let sawFunctionCall = false;

    // fetchGeminiResponseWithRetry only ever returns once response.ok &&
    // response.body are both true - the non-null assertion just tells
    // TypeScript what that function's own control flow already guarantees.
    for await (const chunk of parseSseJsonStream(response.body!)) {
      const candidate = (chunk as GeminiStreamChunk).candidates?.[0];
      const parts = candidate?.content?.parts;
      if (!parts) continue;

      for (const part of parts) {
        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text", text: part.text };
        } else if (part.functionCall && typeof part.functionCall.name === "string") {
          sawFunctionCall = true;
          const id = `call_${callIndex++}`;
          // Recorded before yielding - by the time a caller acts on this
          // event and eventually calls streamTurn() again for the next
          // round, this map already has the signature ready to attach to
          // the matching functionCall part (see toGeminiPart).
          if (typeof part.thoughtSignature === "string" && part.thoughtSignature.length > 0) {
            this.#thoughtSignatures.set(id, part.thoughtSignature);
          }
          yield {
            type: "tool_use",
            // Gemini has no call-id concept - synthesized purely to
            // satisfy this codebase's internal StreamEvent contract
            // (tool-loop.ts needs a stable identifier per pending call).
            // Never sent back to Gemini itself as an id - toGeminiPart's
            // tool_result branch resolves the function name via
            // toolNameById, and its tool_use branch resolves the
            // thoughtSignature via #thoughtSignatures, both keyed by this
            // same id purely as this class's own internal bookkeeping.
            id,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          };
        }
      }
    }

    // Gemini's own finishReason strings ("STOP", "MAX_TOKENS", ...) don't
    // include a distinct "the model wants to call a tool" value the way
    // Anthropic's stop_reason:"tool_use" does - whether a function call
    // happened is instead read directly off the parts we already saw,
    // which is what tool-loop.ts/agent-runner.ts actually key their
    // "offer another round" decision on.
    yield { type: "stop", reason: sawFunctionCall ? "tool_use" : "end_turn" };
  }
}

function buildToolUseNameIndex(messages: ProviderMessage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") index.set(block.id, block.name);
    }
  }
  return index;
}

function toGeminiContent(
  message: ProviderMessage,
  toolNameById: Map<string, string>,
  thoughtSignatureById: Map<string, string>,
): GeminiContent {
  // Gemini's roles are "user"/"model", not "user"/"assistant" - every
  // assistant turn (including ones that only contain tool_use blocks)
  // maps to "model"; every user turn (including tool_result blocks,
  // which Anthropic sends back as a "user" message) maps to "user".
  const role = message.role === "assistant" ? "model" : "user";

  if (typeof message.content === "string") {
    return { role, parts: [{ text: message.content }] };
  }

  return {
    role,
    parts: message.content.map((block) => toGeminiPart(block, toolNameById, thoughtSignatureById)),
  };
}

function toGeminiPart(
  block: ProviderContentBlock,
  toolNameById: Map<string, string>,
  thoughtSignatureById: Map<string, string>,
): GeminiPart {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (block.type === "tool_use") {
    const part: GeminiPart = {
      functionCall: { name: block.name, args: (block.input as Record<string, unknown>) ?? {} },
    };
    // Only ever the exact value Gemini itself returned for this exact
    // call (see GeminiProvider#thoughtSignatures) - never invented,
    // derived, or defaulted when absent.
    const thoughtSignature = thoughtSignatureById.get(block.id);
    if (thoughtSignature) part.thoughtSignature = thoughtSignature;
    return part;
  }
  // tool_result
  const name = toolNameById.get(block.toolUseId) ?? "unknown_tool";
  return {
    functionResponse: {
      name,
      response: toFunctionResponsePayload(block.content),
    },
  };
}

// Gemini's functionResponse.response must be an object, not a raw string.
// buildToolResultBlock (tool-loop.ts) always produces either a
// JSON-stringified successful result or one fixed, safe plain-text error
// string - this handles both without assuming which one it got.
function toFunctionResponsePayload(content: string): Record<string, unknown> {
  try {
    return { result: JSON.parse(content) };
  } catch {
    return { result: content };
  }
}

// Converts one ProviderToolSpec (already JSON-Schema, via z.toJSONSchema
// in tool-loop.ts) into a Gemini function declaration. Gemini validates
// against an OpenAPI 3.0 subset - keys like `$schema`/`additionalProperties`
// that z.toJSONSchema includes (Zod's `.strict()` schemas emit
// `additionalProperties: false`) are not part of that subset and are
// stripped recursively rather than sent as-is and risk a 400 from Gemini
// over an unrecognized field.
function toGeminiFunctionDeclaration(tool: ProviderToolSpec): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: sanitizeSchemaForGemini(tool.inputSchema),
  };
}

const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "additionalProperties"]);

// z.toJSONSchema() emits standard (lowercase) JSON Schema type strings,
// but Gemini's function-declaration Schema.type is its own enum, whose
// JSON/REST representation is uppercase - sending the lowercase form
// causes Gemini to reject the whole request (the actual bug this fixes).
// Any type string not in this map (there shouldn't be one, given this
// codebase's tool schemas) is passed through unchanged rather than
// dropped, so an unrecognized value fails loudly at Gemini rather than
// silently here.
const JSON_SCHEMA_TYPE_TO_GEMINI: Record<string, string> = {
  object: "OBJECT",
  string: "STRING",
  integer: "INTEGER",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
};

function toGeminiTypeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON_SCHEMA_TYPE_TO_GEMINI[value] ?? value;
}

function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    // `type` is converted directly (never recursed into) - its value is
    // always the type string itself, never a nested schema object to walk.
    // Everything else (in particular `properties`/`items`, wherever they
    // occur at any depth) still recurses through sanitizeSchemaValue, so a
    // nested object's own `type` key is converted the same way when that
    // recursive call reaches this same function again.
    result[key] = key === "type" ? toGeminiTypeValue(value) : sanitizeSchemaValue(value);
  }
  return result;
}

function sanitizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSchemaValue);
  }
  if (value && typeof value === "object") {
    return sanitizeSchemaForGemini(value as Record<string, unknown>);
  }
  return value;
}

// Reads a fetch Response body as a UTF-8 SSE stream and yields one parsed
// JSON value per `data: ...` line. A line that fails to parse is skipped
// rather than thrown - one malformed/partial event should not take down
// an otherwise-working stream, and Gemini's own stream never sends a
// terminal "[DONE]" sentinel the way some other SSE APIs do, so the
// stream's natural end (reader.read() returning done) is the only
// completion signal.
async function* parseSseJsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseSseDataLine(line);
        if (event !== undefined) yield event;
      }
    }

    const trailing = parseSseDataLine(buffer);
    if (trailing !== undefined) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseSseDataLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;

  const jsonText = trimmed.slice("data:".length).trim();
  if (!jsonText) return undefined;

  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}

// Bounded length, never throws, and the API key is stripped from it even
// though a well-behaved API would never echo it back.
async function safeReadBody(response: Response, apiKeyToRedact: string): Promise<string> {
  try {
    const text = await response.text();
    const redacted = text.split(apiKeyToRedact).join("[redacted]");
    return redacted.slice(0, 500);
  } catch {
    return "(no response body)";
  }
}
