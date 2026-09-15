import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIEmbeddingProvider } from "./openai-embedding-provider";

// A real (non-mocked) env var, same as any other test relying on
// config/*.ts's requireEnv - simpler than module-mocking config/embedding.ts
// for a single fixed value used across every test in this file.
process.env.OPENAI_API_KEY = "test-api-key-should-never-leak";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i === 0 ? seed : 0));
}

test("embed([]) returns [] without calling fetch", async (t) => {
  let called = false;
  t.mock.method(globalThis, "fetch", async () => {
    called = true;
    throw new Error("fetch should not have been called");
  });

  const provider = new OpenAIEmbeddingProvider();
  const result = await provider.embed([]);

  assert.deepEqual(result, []);
  assert.equal(called, false);
});

test("sends the expected request: endpoint, method, headers, model, input", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      data: [{ embedding: fakeEmbedding(1), index: 0 }],
    });
  });

  const provider = new OpenAIEmbeddingProvider();
  await provider.embed(["hello world"]);

  assert.equal(capturedUrl, "https://api.openai.com/v1/embeddings");
  assert.equal(capturedInit?.method, "POST");

  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, "Bearer test-api-key-should-never-leak");

  const body = JSON.parse(capturedInit?.body as string);
  assert.equal(body.model, "text-embedding-3-small");
  assert.deepEqual(body.input, ["hello world"]);
});

test("preserves embedding order even when the response is out of order", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      // Deliberately returned out of order - the provider must reorder by
      // `index`, not trust array position.
      data: [
        { embedding: fakeEmbedding(2), index: 1 },
        { embedding: fakeEmbedding(1), index: 0 },
        { embedding: fakeEmbedding(3), index: 2 },
      ],
    }),
  );

  const provider = new OpenAIEmbeddingProvider();
  const result = await provider.embed(["first", "second", "third"]);

  assert.equal(result.length, 3);
  assert.equal(result[0][0], 1);
  assert.equal(result[1][0], 2);
  assert.equal(result[2][0], 3);
});

test("successful response with multiple embeddings returns one vector per input", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      data: [
        { embedding: fakeEmbedding(10), index: 0 },
        { embedding: fakeEmbedding(20), index: 1 },
      ],
    }),
  );

  const provider = new OpenAIEmbeddingProvider();
  const result = await provider.embed(["a", "b"]);

  assert.equal(result.length, 2);
  assert.equal(result[0].length, 1536);
  assert.equal(result[1].length, 1536);
});

test("rejects a non-2xx HTTP response with a bounded, safe error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("Rate limit exceeded, please slow down.", { status: 429 }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(
    () => provider.embed(["x"]),
    (err: Error) => {
      assert.match(err.message, /429/);
      assert.match(err.message, /Rate limit exceeded/);
      return true;
    },
  );
});

test("bounds an oversized error response body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("E".repeat(5000), { status: 500 }));

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["x"]), (err: Error) => {
    // The whole error message (status text + body) must be reasonably
    // bounded, not a multi-kilobyte dump of the raw response.
    assert.ok(err.message.length < 600, `error message was ${err.message.length} chars`);
    return true;
  });
});

test("rejects when the provider returns the wrong number of embeddings", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, { data: [{ embedding: fakeEmbedding(1), index: 0 }] }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a", "b", "c"]), /3 inputs/);
});

test("rejects an embedding with the wrong number of dimensions", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, { data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /dimensions/);
});

test("rejects an embedding containing a non-finite value (NaN/Infinity/non-number)", async (t) => {
  const badEmbedding = fakeEmbedding(1);
  badEmbedding[5] = Number.POSITIVE_INFINITY;

  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, { data: [{ embedding: badEmbedding, index: 0 }] }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /non-finite/);
});

test("rejects an embedding that is not an array", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, { data: [{ embedding: "not-an-array", index: 0 }] }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /was not an array/);
});

test("exposes the expected name and dimensions", () => {
  const provider = new OpenAIEmbeddingProvider();
  assert.equal(provider.name, "openai-text-embedding-3-small");
  assert.equal(provider.dimensions, 1536);
});

test("the API key never appears in a thrown error message, even if the response echoes it", async (t) => {
  // Simulates a misbehaving/malicious response that echoes back something
  // resembling the request - the redaction must strip it regardless.
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Invalid request, you sent key test-api-key-should-never-leak", { status: 400 }),
  );

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), (err: Error) => {
    assert.ok(!err.message.includes("test-api-key-should-never-leak"));
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
});

test("a network-level fetch failure produces a generic, safe error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("getaddrinfo ENOTFOUND api.openai.com");
  });

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /Could not reach the embedding provider/);
});
