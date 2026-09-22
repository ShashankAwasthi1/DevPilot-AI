import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ProviderUnavailableError, type ProviderToolSpec, type StreamEvent } from "../provider";

// Real (non-mocked) env vars - simpler than module-mocking config/ai.ts
// for fixed values used across every test in this file, same convention
// gemini.provider.test.ts already uses.
process.env.AI_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key-should-never-leak";
process.env.ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

let importCounter = 0;
function importFreshProvider() {
  return import(`./anthropic.provider?test=${importCounter++}`) as Promise<
    typeof import("./anthropic.provider")
  >;
}

// Deliberately NOT the real @anthropic-ai/sdk, and this file never
// imports it at all (not even for its error classes) - t.mock.module()
// only ever affects a module's FIRST evaluation per resolved specifier
// (same constraint documented throughout this codebase's test suite), so
// any top-level `import ... from "@anthropic-ai/sdk"` here would
// permanently lock that bare specifier to the real package before a
// single test ever got a chance to mock it, and every subsequent
// `t.mock.module("@anthropic-ai/sdk", ...)` call in this file would then
// silently do nothing - anthropic.provider.ts would keep hitting the real
// API. These fake classes only need to satisfy the two things
// anthropic.provider.ts's own classifier actually depends on:
// `err instanceof Anthropic.APIError` and `err.status`/`err.message` -
// real subclass names are mirrored for test readability, not because the
// classifier cares about them.
class FakeAPIError extends Error {
  status?: number;
  // Mirrors the real SDK's APIError.type - null unless the constructing
  // response/frame carried an `error.type` string (see APIError.generate
  // in the real SDK). A real mid-stream in-band SSE `event: error` frame
  // has status: undefined and only this field to classify by.
  type: string | null;
  constructor(status: number | undefined, message: string, type: string | null = null) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.type = type;
  }
}
class FakeRateLimitError extends FakeAPIError {}
class FakeInternalServerError extends FakeAPIError {}
class FakeBadRequestError extends FakeAPIError {}
class FakeAuthenticationError extends FakeAPIError {}
class FakePermissionDeniedError extends FakeAPIError {}
class FakeNotFoundError extends FakeAPIError {}
class FakeUnprocessableEntityError extends FakeAPIError {}
// Real APIConnectionError/APIConnectionTimeoutError/APIUserAbortError
// carry status: undefined - there was never an HTTP response to read a
// status from - which is exactly the property the classifier keys on to
// leave them unclassified.
class FakeAPIConnectionError extends FakeAPIError {
  constructor(message: string) {
    super(undefined, message);
    this.name = "APIConnectionError";
  }
}
class FakeAPIConnectionTimeoutError extends FakeAPIConnectionError {}
class FakeAPIUserAbortError extends FakeAPIError {
  constructor() {
    super(undefined, "Request was aborted.");
    this.name = "APIUserAbortError";
  }
}

const FAKE_ANTHROPIC_ERROR_CLASSES = {
  APIError: FakeAPIError,
  RateLimitError: FakeRateLimitError,
  InternalServerError: FakeInternalServerError,
  BadRequestError: FakeBadRequestError,
  AuthenticationError: FakeAuthenticationError,
  PermissionDeniedError: FakePermissionDeniedError,
  NotFoundError: FakeNotFoundError,
  UnprocessableEntityError: FakeUnprocessableEntityError,
  APIConnectionError: FakeAPIConnectionError,
  APIConnectionTimeoutError: FakeAPIConnectionTimeoutError,
  APIUserAbortError: FakeAPIUserAbortError,
};

// A minimal fake of the real Anthropic client - only the one method
// anthropic.provider.ts actually calls (`messages.stream`), plus the
// fake error classes above attached as static properties exactly the way
// the real SDK attaches its own (so `Anthropic.APIError` etc. resolve
// inside the mocked module the same way they do against the real one).
function mockAnthropicSdk(t: TestContext, streamFactory: (params: unknown, options: unknown) => unknown) {
  class FakeAnthropicClient {
    constructor(_opts: { apiKey: string }) {}
    messages = {
      stream: (params: unknown, options: unknown) => streamFactory(params, options),
    };
  }
  Object.assign(FakeAnthropicClient, FAKE_ANTHROPIC_ERROR_CLASSES);

  t.mock.module("@anthropic-ai/sdk", { defaultExport: FakeAnthropicClient });
}

// A normal, successful fake stream - async-iterable over the given raw
// SDK events, plus a finalMessage() resolving to the given final shape.
// Mirrors exactly what anthropic.provider.ts consumes: it never touches
// anything else on the real MessageStream.
function fakeStream(events: unknown[], finalMessage: { content: unknown[]; stop_reason: string | null }) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) yield event;
    },
    finalMessage: async () => finalMessage,
  };
}

// A stream that yields the given events, then throws - models a
// mid-stream failure (an in-band SSE `event: error`, or a connection
// drop) after some legitimate events already went out. finalMessage()
// must never be reached in this case (the iteration itself already
// threw), so it's left to throw loudly if that assumption is ever wrong.
function fakeStreamThatFailsMidIteration(eventsBeforeError: unknown[], error: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of eventsBeforeError) yield event;
      throw error;
    },
    finalMessage: async () => {
      throw new Error("finalMessage() must never be called after the iteration itself already threw");
    },
  };
}

// A stream whose iteration completes normally but finalMessage() itself
// throws - the second call site the SDK exposes, covered separately per
// the task's own requirement to catch errors from both.
function fakeStreamThatFailsOnFinalMessage(events: unknown[], error: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) yield event;
    },
    finalMessage: async () => {
      throw error;
    },
  };
}

async function collect(events: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const result: StreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

const NO_TOOLS: ProviderToolSpec[] = [];
const BASE_PARAMS = {
  systemPrompt: "You are a helpful assistant.",
  maxOutputTokens: 512,
  signal: new AbortController().signal,
};

function textDelta(text: string) {
  return { type: "content_block_delta", delta: { type: "text_delta", text } };
}

// --- 1. normal streaming behavior, unaffected by this change ---------------

test("streamTurn: converts text deltas into text events, then a final stop event carrying the real stop_reason", async (t) => {
  mockAnthropicSdk(t, () =>
    fakeStream([textDelta("Hello"), textDelta(" world")], { content: [], stop_reason: "end_turn" }),
  );

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events, [
    { type: "text", text: "Hello" },
    { type: "text", text: " world" },
    { type: "stop", reason: "end_turn" },
  ]);
});

test("streamTurn: a tool_use content block is yielded with its id/name/input, and stop_reason 'tool_use' is preserved", async (t) => {
  mockAnthropicSdk(t, () =>
    fakeStream([textDelta("Let me check.")], {
      content: [{ type: "tool_use", id: "call_1", name: "getProject", input: {} }],
      stop_reason: "tool_use",
    }),
  );

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events, [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: "call_1", name: "getProject", input: {} },
    { type: "stop", reason: "tool_use" },
  ]);
});

test("streamTurn: a missing stop_reason falls back to 'end_turn', unchanged from before this phase", async (t) => {
  mockAnthropicSdk(t, () => fakeStream([], { content: [], stop_reason: null }));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events, [{ type: "stop", reason: "end_turn" }]);
});

test("streamTurn: throws if invoked while AI_PROVIDER is not 'anthropic' (defensive config-narrowing guard, unaffected by this change)", async (t) => {
  mockAnthropicSdk(t, () => fakeStream([], { content: [], stop_reason: "end_turn" }));
  const original = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "unused";
  process.env.GEMINI_MODEL = "unused";
  try {
    const { AnthropicProvider } = await importFreshProvider();
    const provider = new AnthropicProvider();
    await assert.rejects(
      () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
      /AI_PROVIDER is not "anthropic"/,
    );
  } finally {
    process.env.AI_PROVIDER = original;
  }
});

test("exposes the expected provider name", async (t) => {
  mockAnthropicSdk(t, () => fakeStream([], { content: [], stop_reason: "end_turn" }));
  const { AnthropicProvider } = await importFreshProvider();
  assert.equal(new AnthropicProvider().name, "anthropic");
});

// --- 2. error classification: transient (ProviderUnavailableError) ---------

for (const status of [500, 502, 503, 504]) {
  test(`streamTurn: a ${status} that survives the SDK's own retries throws ProviderUnavailableError`, async (t) => {
    const sdkError = new FakeInternalServerError(status, `${status} upstream error`);
    mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

    const { AnthropicProvider } = await importFreshProvider();
    const provider = new AnthropicProvider();

    await assert.rejects(
      () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
      (err: unknown) => {
        assert.equal(err instanceof ProviderUnavailableError, true, `a ${status} must be classified as ProviderUnavailableError`);
        assert.match((err as Error).message, new RegExp(String(status)));
        return true;
      },
    );
  });
}

test("streamTurn: a 429 that survives the SDK's own retries throws ProviderUnavailableError", async (t) => {
  const sdkError = new FakeRateLimitError(429, "429 rate limited");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, true);
      assert.match((err as Error).message, /429/);
      return true;
    },
  );
});

// --- 2b. error classification: in-band error `type`, no numeric status ----
//
// A real mid-stream SSE `event: error` frame is converted by the SDK into
// an APIError with status: undefined - there was never an HTTP status
// line for it, only its own `error.type` string. These tests construct
// exactly that shape (status undefined, only `type` set) to prove the
// classifier's type-based check, not its status-based one, is what
// catches this case.

test("streamTurn: an in-band rate_limit_error (status undefined, only `type` set) throws ProviderUnavailableError", async (t) => {
  const sdkError = new FakeAPIError(undefined, "rate limited", "rate_limit_error");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, true, "rate_limit_error must be classified as ProviderUnavailableError");
      assert.equal((err as Error).message, "rate limited");
      return true;
    },
  );
});

test("streamTurn: an in-band overloaded_error (status undefined, only `type` set) throws ProviderUnavailableError", async (t) => {
  const sdkError = new FakeAPIError(undefined, "overloaded", "overloaded_error");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, true, "overloaded_error must be classified as ProviderUnavailableError");
      assert.equal((err as Error).message, "overloaded");
      return true;
    },
  );
});

test("streamTurn: an in-band error with an unrecognized `type` (status undefined) is never classified as ProviderUnavailableError - rethrown unchanged", async (t) => {
  const sdkError = new FakeAPIError(undefined, "something else went wrong", "some_future_error_type");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(
        err instanceof ProviderUnavailableError,
        false,
        "an unrecognized error type must never be guessed at as transient",
      );
      assert.equal(err, sdkError, "the original error must be rethrown completely unchanged, not wrapped");
      return true;
    },
  );
});

test("streamTurn: a permanent error's `type` (e.g. invalid_request_error) is never classified as ProviderUnavailableError even though it has a `type` at all", async (t) => {
  const sdkError = new FakeBadRequestError(400, "bad request", "invalid_request_error");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, false);
      assert.equal(err, sdkError);
      return true;
    },
  );
});

// --- 3. error classification: permanent (never ProviderUnavailableError) ---

const PERMANENT_STATUS_CASES: { status: number; ErrorClass: typeof FakeAPIError }[] = [
  { status: 400, ErrorClass: FakeBadRequestError },
  { status: 401, ErrorClass: FakeAuthenticationError },
  { status: 403, ErrorClass: FakePermissionDeniedError },
  { status: 404, ErrorClass: FakeNotFoundError },
  { status: 422, ErrorClass: FakeUnprocessableEntityError },
];

for (const { status, ErrorClass } of PERMANENT_STATUS_CASES) {
  test(`streamTurn: a ${status} (${ErrorClass.name}) is never classified as ProviderUnavailableError - rethrown unchanged`, async (t) => {
    const sdkError = new ErrorClass(status, `${status} permanent failure`);
    mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

    const { AnthropicProvider } = await importFreshProvider();
    const provider = new AnthropicProvider();

    await assert.rejects(
      () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
      (err: unknown) => {
        assert.equal(err instanceof ProviderUnavailableError, false, `a ${status} must never become ProviderUnavailableError`);
        assert.equal(err, sdkError, "the original error must be rethrown completely unchanged, not wrapped");
        return true;
      },
    );
  });
}

test("streamTurn: an APIConnectionError (no HTTP response at all) is never classified as ProviderUnavailableError", async (t) => {
  const sdkError = new FakeAPIConnectionError("Connection error.");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, false);
      assert.equal(err, sdkError);
      return true;
    },
  );
});

test("streamTurn: an APIConnectionTimeoutError is never classified as ProviderUnavailableError", async (t) => {
  const sdkError = new FakeAPIConnectionTimeoutError("Request timed out.");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, false);
      assert.equal(err, sdkError);
      return true;
    },
  );
});

test("streamTurn: an APIUserAbortError (client/timeout abort) is never classified as ProviderUnavailableError, and abort behavior is unchanged", async (t) => {
  const sdkError = new FakeAPIUserAbortError();
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, false);
      assert.equal(err, sdkError);
      return true;
    },
  );
});

test("streamTurn: a non-API, non-Error thrown value is rethrown unchanged (never crashes the classifier itself)", async (t) => {
  const weirdError = { not: "a real error" };
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], weirdError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err, weirdError);
      assert.equal(err instanceof ProviderUnavailableError, false);
      return true;
    },
  );
});

// --- 4. mid-stream failures: already-yielded output is never "successful" --

test("streamTurn: a mid-stream 429 after text was already yielded propagates as ProviderUnavailableError, with NO stop event ever produced", async (t) => {
  const sdkError = new FakeRateLimitError(429, "429 rate limited");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([textDelta("partial answer")], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  const events: StreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of provider.streamTurn({
      ...BASE_PARAMS,
      messages: [{ role: "user", content: "hi" }],
      tools: NO_TOOLS,
    })) {
      events.push(event);
    }
  }, (err: unknown) => err instanceof ProviderUnavailableError);

  // The text that was already streamed to the client stays in `events` -
  // this only proves no `stop` event ever followed it, so agent-runner.ts/
  // tool-loop.ts can never treat this as a completed, persistable turn.
  assert.deepEqual(events, [{ type: "text", text: "partial answer" }]);
});

test("streamTurn: a mid-stream 5xx after a tool_use-free text run propagates as ProviderUnavailableError, with NO stop event ever produced", async (t) => {
  const sdkError = new FakeInternalServerError(503, "503 overloaded");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([textDelta("first"), textDelta(" second")], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  const events: StreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of provider.streamTurn({
      ...BASE_PARAMS,
      messages: [{ role: "user", content: "hi" }],
      tools: NO_TOOLS,
    })) {
      events.push(event);
    }
  }, (err: unknown) => err instanceof ProviderUnavailableError);

  assert.deepEqual(events, [
    { type: "text", text: "first" },
    { type: "text", text: " second" },
  ]);
  assert.ok(!events.some((e) => e.type === "stop"), "no stop event may ever be produced once a mid-stream error has occurred");
});

test("streamTurn: a failure from finalMessage() itself (after iteration completed cleanly) is still classified and never produces a stop event", async (t) => {
  const sdkError = new FakeInternalServerError(500, "500 boom");
  mockAnthropicSdk(t, () => fakeStreamThatFailsOnFinalMessage([textDelta("hello")], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  const events: StreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of provider.streamTurn({
      ...BASE_PARAMS,
      messages: [{ role: "user", content: "hi" }],
      tools: NO_TOOLS,
    })) {
      events.push(event);
    }
  }, (err: unknown) => err instanceof ProviderUnavailableError);

  assert.deepEqual(events, [{ type: "text", text: "hello" }]);
});

// --- 5. no duplicate retry, no secret exposure ------------------------------

test("streamTurn: our own provider code never calls client.messages.stream more than once per turn (no second retry layer on top of the SDK's own)", async (t) => {
  let streamCalls = 0;
  const sdkError = new FakeRateLimitError(429, "429 rate limited");
  mockAnthropicSdk(t, () => {
    streamCalls++;
    return fakeStreamThatFailsMidIteration([], sdkError);
  });

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(() =>
    collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
  );

  assert.equal(streamCalls, 1, "classification must never trigger a second call to messages.stream()");
});

test("streamTurn: classification never has access to the API key at all - it only ever reads err.status/err.message, never config", async (t) => {
  // A realistic Anthropic error message - the real API never echoes the
  // request's own API key back in an error body (it's a request header,
  // never part of a response), so this is what classifyAnthropicError
  // actually ever receives in practice. classifyAnthropicError's own
  // signature (err, APIError class) structurally has no access to
  // config.anthropicApiKey at all, so there is nothing for it to leak -
  // this test locks in that the classified error's message is exactly
  // (and only) the original message, never anything constructed from or
  // augmented with configuration/secrets.
  const sdkError = new FakeRateLimitError(429, "Quota exceeded, slow down.");
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      assert.equal((err as Error).message, "Quota exceeded, slow down.");
      assert.doesNotMatch((err as Error).message, /test-anthropic-key-should-never-leak/);
      return true;
    },
  );
});

test("streamTurn: the ProviderUnavailableError never carries Authorization/x-api-key header values - only status/message are ever read", async (t) => {
  // A realistic APIError also carries response `.headers` - the
  // classifier must never read or forward that property.
  const sdkError = Object.assign(new FakeInternalServerError(500, "500 boom"), {
    headers: { "x-api-key": "test-anthropic-key-should-never-leak", authorization: "Bearer secret" },
  });
  mockAnthropicSdk(t, () => fakeStreamThatFailsMidIteration([], sdkError));

  const { AnthropicProvider } = await importFreshProvider();
  const provider = new AnthropicProvider();

  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.ok(err instanceof ProviderUnavailableError);
      const serialized = JSON.stringify({ message: (err as Error).message, name: (err as Error).name });
      assert.doesNotMatch(serialized, /test-anthropic-key-should-never-leak/);
      assert.doesNotMatch(serialized, /Bearer secret/);
      // ProviderUnavailableError itself has no `.headers` property at all
      // (it's a bare `extends Error {}`) - the original error's headers
      // are never copied onto it.
      assert.equal((err as unknown as { headers?: unknown }).headers, undefined);
      return true;
    },
  );
});
