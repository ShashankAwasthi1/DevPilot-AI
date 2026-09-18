import { test } from "node:test";
import assert from "node:assert/strict";

// @xenova/transformers is mocked per-test via t.mock.module - the real
// model is never loaded in this suite (no network call, no ONNX runtime
// startup cost), matching the fake-provider convention used everywhere
// else in this codebase's AI tests.
function fakePipeline(rows: number[][]) {
  const dims = [rows.length, rows[0]?.length ?? 0];
  const data = new Float32Array(rows.flat());
  return async () => ({ data, dims });
}

// The module under test caches its loaded pipeline in module-level state
// (by design - see local-embedding-provider.ts's "loaded once per
// process" comment), which means a plain repeated `import("./local-...")`
// would return the same cached instance across tests in this file and
// leak state between them. A unique query string forces a fresh module
// instance (and therefore a fresh, empty pipeline cache) per test.
let importCounter = 0;
function importFreshProvider() {
  return import(`./local-embedding-provider?test=${importCounter++}`) as Promise<
    typeof import("./local-embedding-provider")
  >;
}

test("embed([]) returns [] without loading the pipeline", async (t) => {
  let called = false;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      pipeline: async () => {
        called = true;
        throw new Error("pipeline should not have been loaded");
      },
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  const result = await provider.embed([]);

  assert.deepEqual(result, []);
  assert.equal(called, false);
});

test("returns one 384-dimension vector per input, mean-pooled and normalized", async (t) => {
  const row0 = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  const row1 = Array.from({ length: 384 }, (_, i) => (i === 0 ? 2 : 0));

  let capturedTexts: string[] | undefined;
  let capturedOptions: unknown;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => async (texts: string[], options: unknown) => {
        capturedTexts = texts;
        capturedOptions = options;
        return fakePipeline([row0, row1])();
      },
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  const result = await provider.embed(["hello", "world"]);

  assert.deepEqual(capturedTexts, ["hello", "world"]);
  assert.deepEqual(capturedOptions, { pooling: "mean", normalize: true });
  assert.equal(result.length, 2);
  assert.equal(result[0].length, 384);
  assert.equal(result[1].length, 384);
  assert.equal(result[0][0], 1);
  assert.equal(result[1][0], 2);
});

test("loads the pipeline only once across multiple embed() calls", async (t) => {
  let loadCount = 0;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => {
        loadCount++;
        return fakePipeline([Array.from({ length: 384 }, () => 0.1)]);
      },
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await provider.embed(["a"]);
  await provider.embed(["b"]);
  await provider.embed(["c"]);

  assert.equal(loadCount, 1);
});

test("rejects when the pipeline returns the wrong number of embeddings", async (t) => {
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => fakePipeline([Array.from({ length: 384 }, () => 0.1)]),
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a", "b"]), /2 inputs/);
});

test("rejects an embedding with the wrong number of dimensions", async (t) => {
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => fakePipeline([[0.1, 0.2, 0.3]]),
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /dimensions/);
});

test("rejects an embedding containing a non-finite value (NaN/Infinity)", async (t) => {
  const row = Array.from({ length: 384 }, () => 0.1);
  row[5] = Number.POSITIVE_INFINITY;

  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => fakePipeline([row]),
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /non-finite/);
});

test("a pipeline-level failure produces a generic, safe error", async (t) => {
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => async () => {
        throw new Error("some internal ONNX runtime detail");
      },
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await assert.rejects(() => provider.embed(["a"]), /Could not run the local embedding model/);
});

test("exposes the expected name and dimensions", async (t) => {
  t.mock.module("@xenova/transformers", { namedExports: {} });
  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  assert.equal(provider.name, "local-all-MiniLM-L6-v2");
  assert.equal(provider.dimensions, 384);
});

// --- Phase 27 Step 5: cache directory + model status/warm-up -------------

test("sets @xenova/transformers' env.cacheDir to the configured EMBEDDING_MODEL_CACHE_DIR before loading the pipeline, and never inside node_modules", async (t) => {
  t.mock.module("../config/env", {
    namedExports: { env: { embeddingModelCacheDir: "/var/data/transformers-model-cache" } },
  });

  const transformersEnv: Record<string, unknown> = {};
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: transformersEnv,
      pipeline: async () => fakePipeline([Array.from({ length: 384 }, () => 0.1)]),
    },
  });

  const { LocalEmbeddingProvider } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();
  await provider.embed(["a"]);

  assert.equal(transformersEnv.cacheDir, "/var/data/transformers-model-cache");
});

test("getEmbeddingModelStatus: starts idle, transitions to loading while the pipeline is in flight, then ready once it resolves", async (t) => {
  let resolvePipeline!: (extractor: unknown) => void;
  const pipelineLoad = new Promise((resolve) => {
    resolvePipeline = resolve;
  });

  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => pipelineLoad,
    },
  });

  const { LocalEmbeddingProvider, getEmbeddingModelStatus } = await importFreshProvider();
  assert.equal(getEmbeddingModelStatus(), "idle");

  const provider = new LocalEmbeddingProvider();
  const embedPromise = provider.embed(["a"]);

  // Yield once so loadPipeline()'s synchronous "loading" assignment (set
  // before the still-pending pipeline() call) has had a chance to run.
  await Promise.resolve();
  assert.equal(getEmbeddingModelStatus(), "loading");

  resolvePipeline(fakePipeline([Array.from({ length: 384 }, () => 0.1)]));
  await embedPromise;

  assert.equal(getEmbeddingModelStatus(), "ready");
});

test("getEmbeddingModelStatus: becomes failed if the pipeline fails to load, and stays failed (never silently retried) on a later call", async (t) => {
  let loadAttempts = 0;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => {
        loadAttempts++;
        throw new Error("could not download model weights");
      },
    },
  });

  const { LocalEmbeddingProvider, getEmbeddingModelStatus } = await importFreshProvider();
  const provider = new LocalEmbeddingProvider();

  await assert.rejects(() => provider.embed(["a"]));
  assert.equal(getEmbeddingModelStatus(), "failed");

  await assert.rejects(() => provider.embed(["b"]));
  assert.equal(getEmbeddingModelStatus(), "failed");
  assert.equal(loadAttempts, 1, "a failed load must never be silently retried");
});

test("warmUpEmbeddingModel: shares the same pipeline load as embed() - never a second pipeline either direction", async (t) => {
  let loadCount = 0;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => {
        loadCount++;
        return fakePipeline([Array.from({ length: 384 }, () => 0.1)]);
      },
    },
  });

  const { LocalEmbeddingProvider, warmUpEmbeddingModel, getEmbeddingModelStatus } = await importFreshProvider();

  await warmUpEmbeddingModel();
  assert.equal(getEmbeddingModelStatus(), "ready");

  const provider = new LocalEmbeddingProvider();
  await provider.embed(["a"]);

  assert.equal(loadCount, 1, "embed() after a warm-up must reuse the already-loaded pipeline");
});

test("warmUpEmbeddingModel: called after embed() also reuses the existing pipeline, not a second one", async (t) => {
  let loadCount = 0;
  t.mock.module("@xenova/transformers", {
    namedExports: {
      env: {},
      pipeline: async () => {
        loadCount++;
        return fakePipeline([Array.from({ length: 384 }, () => 0.1)]);
      },
    },
  });

  const { LocalEmbeddingProvider, warmUpEmbeddingModel } = await importFreshProvider();

  const provider = new LocalEmbeddingProvider();
  await provider.embed(["a"]);
  await warmUpEmbeddingModel();

  assert.equal(loadCount, 1);
});
