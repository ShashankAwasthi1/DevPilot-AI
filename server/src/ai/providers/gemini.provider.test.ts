import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "./gemini.provider";
import { ProviderUnavailableError, type ProviderMessage, type ProviderToolSpec, type StreamEvent } from "../provider";

// Real (non-mocked) env vars - simpler than module-mocking config/ai.ts
// for fixed values used across every test in this file.
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-gemini-key-should-never-leak";
process.env.GEMINI_MODEL = "gemini-2.5-flash";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
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

// --- 1. text streaming conversion -----------------------------------------

test("streamTurn: converts Gemini text parts into text events, then a final stop event", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse([
      { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: " world" }] }, finishReason: "STOP" }] },
    ]),
  );

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({
      ...BASE_PARAMS,
      messages: [{ role: "user", content: "hi" }],
      tools: NO_TOOLS,
    }),
  );

  assert.deepEqual(events, [
    { type: "text", text: "Hello" },
    { type: "text", text: " world" },
    { type: "stop", reason: "end_turn" },
  ]);
});

// --- 2. Gemini tool call -> internal tool call -----------------------------

test("streamTurn: converts a Gemini functionCall part into an internal tool_use event, with stop reason 'tool_use'", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "getTasks", args: { limit: 5 } } }],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]),
  );

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({
      ...BASE_PARAMS,
      messages: [{ role: "user", content: "list my tasks" }],
      tools: [{ name: "getTasks", description: "List tasks", inputSchema: { type: "object" } }],
    }),
  );

  assert.deepEqual(events, [
    { type: "tool_use", id: "call_0", name: "getTasks", input: { limit: 5 } },
    { type: "stop", reason: "tool_use" },
  ]);
});

test("streamTurn: a functionCall with no args defaults to an empty object input", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { name: "getProject" } }] } }] }]),
  );

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events[0], { type: "tool_use", id: "call_0", name: "getProject", input: {} });
});

// --- 3. internal tool result -> Gemini-compatible request ------------------

test("streamTurn: sends a tool_result block back to Gemini as a functionResponse, resolving the function name from the matching tool_use id", async (t) => {
  let capturedBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init!.body as string);
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "done" }] } }] }]);
  });

  const messages: ProviderMessage[] = [
    { role: "user", content: "list my tasks" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "call_0", name: "getTasks", input: { limit: 5 } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", toolUseId: "call_0", content: '[{"id":"1","title":"Ship it"}]' }],
    },
  ];

  const provider = new GeminiProvider();
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages, tools: NO_TOOLS }));

  const contents = capturedBody!.contents as { role: string; parts: unknown[] }[];
  const lastTurn = contents[contents.length - 1];

  assert.equal(lastTurn.role, "user");
  assert.deepEqual(lastTurn.parts, [
    {
      functionResponse: {
        name: "getTasks",
        response: { result: [{ id: "1", title: "Ship it" }] },
      },
    },
  ]);
});

test("streamTurn: a fixed, non-JSON error tool_result string is wrapped as a plain string result, not dropped or thrown", async (t) => {
  let capturedBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init!.body as string);
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }]);
  });

  const messages: ProviderMessage[] = [
    { role: "assistant", content: [{ type: "tool_use", id: "call_0", name: "getTasks", input: {} }] },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          toolUseId: "call_0",
          content: "This tool call could not be completed.",
          isError: true,
        },
      ],
    },
  ];

  const provider = new GeminiProvider();
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages, tools: NO_TOOLS }));

  const contents = capturedBody!.contents as { role: string; parts: { functionResponse: unknown }[] }[];
  assert.deepEqual(contents[contents.length - 1].parts[0].functionResponse, {
    name: "getTasks",
    response: { result: "This tool call could not be completed." },
  });
});

// Shared by the schema-sanitization tests below - captures the exact
// `parameters` object sent to Gemini for a single tool with the given
// inputSchema, without needing to repeat the fetch-mock/streamTurn
// boilerplate in every test. Takes the test's own `t` so it can use the
// same t.mock.method convention as every other test in this file.
async function capturedFunctionParameters(
  t: TestContext,
  inputSchema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let capturedBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init!.body as string);
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }]);
  });

  const tools: ProviderToolSpec[] = [{ name: "getTasks", description: "List tasks", inputSchema }];
  const provider = new GeminiProvider();
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools }));

  const sentTools = capturedBody!.tools as { functionDeclarations: Record<string, unknown>[] }[];
  return sentTools[0].functionDeclarations[0].parameters as Record<string, unknown>;
}

test("streamTurn: strips $schema from tool input schemas before sending function declarations", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {},
  });

  assert.equal("$schema" in parameters, false);
});

test("streamTurn: strips additionalProperties from tool input schemas before sending function declarations", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });

  assert.equal("additionalProperties" in parameters, false);
});

test("streamTurn: converts a top-level object schema's type to Gemini's uppercase enum", async (t) => {
  const parameters = await capturedFunctionParameters(t, { type: "object", properties: {} });

  assert.equal(parameters.type, "OBJECT");
});

test("streamTurn: converts string/integer/number/boolean/array property types to Gemini's uppercase enum", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    type: "object",
    properties: {
      aString: { type: "string" },
      anInteger: { type: "integer" },
      aNumber: { type: "number" },
      aBoolean: { type: "boolean" },
      anArray: { type: "array", items: { type: "string" } },
    },
  });

  const properties = parameters.properties as Record<string, { type: unknown }>;
  assert.equal(properties.aString.type, "STRING");
  assert.equal(properties.anInteger.type, "INTEGER");
  assert.equal(properties.aNumber.type, "NUMBER");
  assert.equal(properties.aBoolean.type, "BOOLEAN");
  assert.equal(properties.anArray.type, "ARRAY");
});

test("streamTurn: converts nested property types at every depth, not just the top level", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    type: "object",
    properties: {
      filter: {
        type: "object",
        properties: {
          status: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
  });

  const properties = parameters.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.filter.type, "OBJECT");
  const nested = properties.filter.properties as Record<string, { type: unknown }>;
  assert.equal(nested.status.type, "STRING");
  assert.equal(nested.limit.type, "INTEGER");
});

test("streamTurn: converts an array schema's own type and its items' type", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
      },
    },
  });

  const tags = (parameters.properties as Record<string, Record<string, unknown>>).tags;
  assert.equal(tags.type, "ARRAY");
  assert.equal((tags.items as { type: unknown }).type, "STRING");
});

test("streamTurn: leaves an already-unrecognized type value unchanged rather than dropping it", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    type: "object",
    properties: { weird: { type: "null" } },
  });

  const weird = (parameters.properties as Record<string, { type: unknown }>).weird;
  assert.equal(weird.type, "null");
});

test("streamTurn: a full realistic tool schema (matching PROVIDER_TOOL_SPECS' own shape) is fully sanitized end to end", async (t) => {
  const parameters = await capturedFunctionParameters(t, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 5 },
    },
    required: ["query"],
    additionalProperties: false,
  });

  assert.deepEqual(parameters, {
    type: "OBJECT",
    properties: {
      query: { type: "STRING", minLength: 1, maxLength: 300 },
      limit: { type: "INTEGER", minimum: 1, maximum: 5 },
    },
    required: ["query"],
  });
});

// --- 4. multi-turn tool loop compatibility ---------------------------------

test("streamTurn: a two-round tool-call-then-result sequence round-trips correctly across two calls", async (t) => {
  const capturedBodies: Record<string, unknown>[] = [];
  let call = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(init!.body as string));
    call++;
    if (call === 1) {
      return sseResponse([
        { candidates: [{ content: { parts: [{ functionCall: { name: "getTasks", args: { limit: 3 } } }] } }] },
      ]);
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "You have 1 task." }] } }] }]);
  });

  const provider = new GeminiProvider();
  const tools: ProviderToolSpec[] = [{ name: "getTasks", description: "List tasks", inputSchema: { type: "object" } }];

  // Round 1: tools offered, model asks to call getTasks.
  const round1Events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "list my tasks" }], tools }),
  );
  const toolUse = round1Events.find((e) => e.type === "tool_use");
  assert.ok(toolUse && toolUse.type === "tool_use");
  assert.equal(toolUse.name, "getTasks");

  // Round 2: exactly what tool-loop.ts's runChatTurn would build - the
  // assistant's tool_use block followed by a user tool_result block -
  // tools withheld this round, same as the real orchestrator's final round.
  const round2Messages: ProviderMessage[] = [
    { role: "user", content: "list my tasks" },
    { role: "assistant", content: [{ type: "tool_use", id: toolUse.id, name: "getTasks", input: toolUse.input }] },
    {
      role: "user",
      content: [{ type: "tool_result", toolUseId: toolUse.id, content: '[{"id":"1"}]' }],
    },
  ];
  const round2Events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: round2Messages, tools: NO_TOOLS }),
  );

  assert.deepEqual(round2Events, [
    { type: "text", text: "You have 1 task." },
    { type: "stop", reason: "end_turn" },
  ]);

  // Round 2's request must correctly carry the prior functionCall/
  // functionResponse pair, converted from the internal representation.
  const round2Contents = capturedBodies[1].contents as { role: string; parts: unknown[] }[];
  assert.deepEqual(round2Contents[1], {
    role: "model",
    parts: [{ functionCall: { name: "getTasks", args: { limit: 3 } } }],
  });
  assert.deepEqual(round2Contents[2], {
    role: "user",
    parts: [{ functionResponse: { name: "getTasks", response: { result: [{ id: "1" }] } } }],
  });
  // Round 2 offered no tools - matching runChatTurn's final-round contract.
  assert.equal("tools" in capturedBodies[1], false);
});

// --- thoughtSignature preservation (Gemini 3 "thinking" models) -----------

test("streamTurn: a functionCall part's thoughtSignature does not appear on the yielded tool_use event (internal bookkeeping only)", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse([
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "getTasks", args: {} }, thoughtSignature: "sig-abc123" }],
            },
          },
        ],
      },
    ]),
  );

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  // StreamEvent's tool_use shape is shared with AnthropicProvider and has
  // no signature field - ProviderContentBlock/tool-loop.ts/agent-runner.ts
  // are untouched by this fix, so nothing here should carry the signature.
  assert.deepEqual(events, [
    { type: "tool_use", id: "call_0", name: "getTasks", input: {} },
    { type: "stop", reason: "tool_use" },
  ]);
});

test("streamTurn: preserves a functionCall's thoughtSignature verbatim when that same call's result is sent back on the next round", async (t) => {
  const capturedBodies: Record<string, unknown>[] = [];
  let call = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(init!.body as string));
    call++;
    if (call === 1) {
      return sseResponse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "getTasks", args: { limit: 3 } }, thoughtSignature: "sig-exact-value" },
                ],
              },
            },
          ],
        },
      ]);
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "done" }] } }] }]);
  });

  // Same provider instance across both rounds - exactly how
  // tool-loop.ts/agent-runner.ts call getAIProvider() once per turn and
  // reuse it, which is what this fix's persistence relies on.
  const provider = new GeminiProvider();
  const tools: ProviderToolSpec[] = [{ name: "getTasks", description: "List tasks", inputSchema: { type: "object" } }];

  const round1Events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "list my tasks" }], tools }),
  );
  const toolUse = round1Events.find((e) => e.type === "tool_use");
  assert.ok(toolUse && toolUse.type === "tool_use");

  // Exactly what tool-loop.ts's runChatTurn builds - ProviderContentBlock
  // has no signature field, so the internal representation this fix must
  // work from is the plain, unmodified existing shape.
  const round2Messages: ProviderMessage[] = [
    { role: "user", content: "list my tasks" },
    { role: "assistant", content: [{ type: "tool_use", id: toolUse.id, name: "getTasks", input: toolUse.input }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: toolUse.id, content: "[]" }] },
  ];
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages: round2Messages, tools: NO_TOOLS }));

  const round2Contents = capturedBodies[1].contents as { role: string; parts: Record<string, unknown>[] }[];
  assert.deepEqual(round2Contents[1], {
    role: "model",
    parts: [
      {
        functionCall: { name: "getTasks", args: { limit: 3 } },
        thoughtSignature: "sig-exact-value",
      },
    ],
  });
});

test("streamTurn: a functionCall with no thoughtSignature still round-trips correctly (existing behavior unaffected)", async (t) => {
  const capturedBodies: Record<string, unknown>[] = [];
  let call = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(init!.body as string));
    call++;
    if (call === 1) {
      return sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { name: "getTasks" } }] } }] }]);
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "done" }] } }] }]);
  });

  const provider = new GeminiProvider();
  const tools: ProviderToolSpec[] = [{ name: "getTasks", description: "List tasks", inputSchema: { type: "object" } }];

  const round1Events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools }),
  );
  const toolUse = round1Events.find((e) => e.type === "tool_use");
  assert.ok(toolUse && toolUse.type === "tool_use");

  const round2Messages: ProviderMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "tool_use", id: toolUse.id, name: "getTasks", input: toolUse.input }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: toolUse.id, content: "[]" }] },
  ];
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages: round2Messages, tools: NO_TOOLS }));

  const round2Contents = capturedBodies[1].contents as { role: string; parts: Record<string, unknown>[] }[];
  // No thoughtSignature key at all - never a fabricated/empty one.
  assert.deepEqual(round2Contents[1].parts[0], { functionCall: { name: "getTasks", args: {} } });
  assert.equal("thoughtSignature" in round2Contents[1].parts[0], false);
});

test("streamTurn: parallel function calls in one round each keep their own distinct thoughtSignature", async (t) => {
  const capturedBodies: Record<string, unknown>[] = [];
  let call = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(init!.body as string));
    call++;
    if (call === 1) {
      return sseResponse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "getTasks", args: {} }, thoughtSignature: "sig-for-getTasks" },
                  { functionCall: { name: "getActivity", args: {} }, thoughtSignature: "sig-for-getActivity" },
                ],
              },
            },
          ],
        },
      ]);
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "done" }] } }] }]);
  });

  const provider = new GeminiProvider();
  const tools: ProviderToolSpec[] = [
    { name: "getTasks", description: "List tasks", inputSchema: { type: "object" } },
    { name: "getActivity", description: "Get activity", inputSchema: { type: "object" } },
  ];

  const round1Events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools }),
  );
  const toolUses = round1Events.filter((e) => e.type === "tool_use");
  assert.equal(toolUses.length, 2);
  assert.ok(toolUses[0].type === "tool_use" && toolUses[1].type === "tool_use");
  // Distinct synthesized ids - required for each call's own signature (and
  // its own tool_result) to be tracked and resolved independently.
  assert.notEqual(toolUses[0].id, toolUses[1].id);

  const round2Messages: ProviderMessage[] = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: toolUses[0].id, name: toolUses[0].name, input: toolUses[0].input },
        { type: "tool_use", id: toolUses[1].id, name: toolUses[1].name, input: toolUses[1].input },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", toolUseId: toolUses[0].id, content: "[]" },
        { type: "tool_result", toolUseId: toolUses[1].id, content: "[]" },
      ],
    },
  ];
  await collect(provider.streamTurn({ ...BASE_PARAMS, messages: round2Messages, tools: NO_TOOLS }));

  const round2Contents = capturedBodies[1].contents as { role: string; parts: Record<string, unknown>[] }[];
  const modelTurnParts = round2Contents[1].parts;
  assert.deepEqual(modelTurnParts[0], {
    functionCall: { name: "getTasks", args: {} },
    thoughtSignature: "sig-for-getTasks",
  });
  assert.deepEqual(modelTurnParts[1], {
    functionCall: { name: "getActivity", args: {} },
    thoughtSignature: "sig-for-getActivity",
  });
});

// --- 5. malformed/invalid provider response handling -----------------------

test("streamTurn: a non-2xx response throws an Error identifying the status, with the API key redacted", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("Invalid API key: test-gemini-key-should-never-leak", { status: 400 }),
  );

  const provider = new GeminiProvider();
  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: Error) => {
      assert.match(err.message, /400/);
      assert.ok(!err.message.includes("test-gemini-key-should-never-leak"));
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );
});

test("streamTurn: a response with no body throws a clear error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));

  const provider = new GeminiProvider();
  await assert.rejects(() =>
    collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
  );
});

test("streamTurn: a malformed JSON data line is skipped without aborting the rest of the stream", async (t) => {
  const body =
    `data: {"candidates":[{"content":{"parts":[{"text":"before"}]}}]}\n\n` +
    `data: {this is not valid json\n\n` +
    `data: {"candidates":[{"content":{"parts":[{"text":"after"}]}}]}\n\n`;

  t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 200 }));

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events, [
    { type: "text", text: "before" },
    { type: "text", text: "after" },
    { type: "stop", reason: "end_turn" },
  ]);
});

test("streamTurn: a chunk with no candidates is skipped without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse([{}, { candidates: [{ content: { parts: [{ text: "hi" }] } }] }]),
  );

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.deepEqual(events, [{ type: "text", text: "hi" }, { type: "stop", reason: "end_turn" }]);
});

test("streamTurn: a network-level fetch failure produces a generic, safe error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com");
  });

  const provider = new GeminiProvider();
  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    /Could not reach the Gemini API/,
  );
});

// --- 6. provider selection/config validation (provider-level guard) --------

test("streamTurn: throws if invoked while AI_PROVIDER is not 'gemini' (defensive config-narrowing guard)", async () => {
  const original = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "unused";
  process.env.ANTHROPIC_MODEL = "unused";
  try {
    const provider = new GeminiProvider();
    await assert.rejects(
      () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
      /AI_PROVIDER is not "gemini"/,
    );
  } finally {
    process.env.AI_PROVIDER = original;
  }
});

test("exposes the expected provider name", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.name, "gemini");
});

// --- 7. transient-failure retry/backoff (503/429) --------------------------
//
// Real bug: Gemini intermittently returns 503 UNAVAILABLE ("high demand")
// or 429 RESOURCE_EXHAUSTED, and a fresh identical request often succeeds
// seconds later. These tests use fake timers (mocking only setTimeout, so
// AbortController's own synchronous event dispatch is unaffected) to
// advance through the retry backoff deterministically, with no real wait.

test("streamTurn: a 503 on the first attempt is retried once and succeeds on the second attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) {
      return new Response("Service temporarily unavailable.", { status: 503 });
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "Hello" }] }, finishReason: "STOP" }] }]);
  });

  const provider = new GeminiProvider();
  const eventsPromise = collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  // Let the first attempt's rejection and the retry's backoff timer get
  // scheduled, then advance exactly past it (500ms = INITIAL_RETRY_BACKOFF_MS).
  await null;
  await null;
  t.mock.timers.tick(500);

  const events = await eventsPromise;

  assert.equal(calls, 2, "exactly one retry attempt - the second call succeeded");
  assert.deepEqual(events, [
    { type: "text", text: "Hello" },
    { type: "stop", reason: "end_turn" },
  ]);
});

test("streamTurn: a 429 on the first attempt is also retried and succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) {
      return new Response("Rate limit exceeded.", { status: 429 });
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }]);
  });

  const provider = new GeminiProvider();
  const eventsPromise = collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  await null;
  await null;
  t.mock.timers.tick(500);

  const events = await eventsPromise;

  assert.equal(calls, 2);
  assert.deepEqual(events, [
    { type: "text", text: "ok" },
    { type: "stop", reason: "end_turn" },
  ]);
});

test("streamTurn: 503 on every attempt exhausts retries and throws a ProviderUnavailableError, never a plain Error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("Service temporarily unavailable.", { status: 503 });
  });

  const provider = new GeminiProvider();
  const eventsPromise = collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );
  const assertionPromise = assert.rejects(eventsPromise, (err: unknown) => {
    assert.equal(err instanceof ProviderUnavailableError, true, "must be the distinct unavailable-error type");
    assert.match((err as Error).message, /503/);
    return true;
  });

  // Two retries configured (MAX_GEMINI_RETRY_ATTEMPTS = 2): backoff 500ms,
  // then 1000ms (exponential), then the third and final attempt fails for
  // good with no further retry.
  await null;
  await null;
  t.mock.timers.tick(500);
  await null;
  await null;
  t.mock.timers.tick(1000);

  await assertionPromise;
  assert.equal(calls, 3, "one initial attempt plus exactly two retries, never more");
});

test("streamTurn: a 400 is never retried - fails immediately on the first attempt with a plain Error", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("Invalid request.", { status: 400 });
  });

  const provider = new GeminiProvider();
  await assert.rejects(
    () => collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    (err: unknown) => {
      assert.equal(err instanceof ProviderUnavailableError, false, "a permanent error must never be the retryable type");
      assert.match((err as Error).message, /400/);
      return true;
    },
  );
  assert.equal(calls, 1, "a non-retryable status must never be retried");
});

for (const status of [401, 403, 404]) {
  test(`streamTurn: a ${status} is never retried`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response("error", { status });
    });

    const provider = new GeminiProvider();
    await assert.rejects(() =>
      collect(provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS })),
    );
    assert.equal(calls, 1);
  });
}

test("streamTurn: a caller abort during the retry backoff delay stops retrying immediately - no further fetch call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("Service temporarily unavailable.", { status: 503 });
  });

  const controller = new AbortController();
  const provider = new GeminiProvider();
  const eventsPromise = collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS, signal: controller.signal }),
  );

  // Abort while the retry backoff timer is still pending - before it ever
  // fires (fake timers never advance unless tick() is called).
  await null;
  await null;
  controller.abort();

  await assert.rejects(eventsPromise);
  assert.equal(calls, 1, "aborting during the backoff wait must prevent the retry's fetch call entirely");
});

test("streamTurn: a successful first attempt never triggers any retry logging or delay (existing fast path unchanged)", async (t) => {
  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "Hello" }] }, finishReason: "STOP" }] }]);
  });

  const provider = new GeminiProvider();
  const events = await collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  assert.equal(calls, 1);
  assert.deepEqual(events, [
    { type: "text", text: "Hello" },
    { type: "stop", reason: "end_turn" },
  ]);
  assert.equal(
    errorLogs.filter((args) => args.some((a) => String(a).includes("Gemini provider"))).length,
    0,
    "a successful first attempt must never log a retry",
  );
});

test("streamTurn: retry logging includes provider/status/attempt/backoff but never the API key, headers, or response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const errorLogs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) {
      // A response body deliberately containing something that must never
      // be logged for a retry - only the exhausted-retry throw path (not
      // exercised here) ever reads/redacts a response body at all.
      return new Response("This model is currently experiencing high demand. Secret-looking-detail-xyz", {
        status: 503,
      });
    }
    return sseResponse([{ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }]);
  });

  const provider = new GeminiProvider();
  const eventsPromise = collect(
    provider.streamTurn({ ...BASE_PARAMS, messages: [{ role: "user", content: "hi" }], tools: NO_TOOLS }),
  );

  await null;
  await null;
  t.mock.timers.tick(500);
  await eventsPromise;

  const retryLogs = errorLogs.filter((args) => args.some((a) => String(a).includes("Gemini provider")));
  assert.equal(retryLogs.length, 1);
  const logged = retryLogs[0].map(String).join(" ");
  assert.match(logged, /503/);
  assert.match(logged, /attempt 1\/2/);
  assert.match(logged, /500ms/);
  assert.equal(logged.includes("test-gemini-key-should-never-leak"), false, "the API key must never be logged");
  assert.equal(logged.includes("Secret-looking-detail-xyz"), false, "the response body must never be logged for a retry");
  assert.equal(logged.includes("x-goog-api-key"), false, "no request header name/value may be logged");
});
