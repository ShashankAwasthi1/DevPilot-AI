import { test } from "node:test";
import assert from "node:assert/strict";

// Phase 27 Step 5: runEmbeddingModelWarmUp is a small, deliberately
// extracted decision function (env flag -> call warmUpEmbeddingModel() or
// not, safe logging, never throws) so it can be unit-tested without
// needing to mock app.listen/express or actually start a server -
// server.ts itself is not imported here.

let importCounter = 0;
function importFreshWarmup() {
  return import(`./embedding-warmup?test=${importCounter++}`) as Promise<
    typeof import("./embedding-warmup")
  >;
}

function captureConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  console.log = (...args: unknown[]) => logs.push(args);
  console.error = (...args: unknown[]) => errors.push(args);
  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

test("runEmbeddingModelWarmUp: does nothing when EMBEDDING_MODEL_WARMUP is disabled - warmUpEmbeddingModel is never called", async (t) => {
  let warmUpCalls = 0;
  t.mock.module("../config/env", {
    namedExports: { env: { embeddingModelWarmupEnabled: false } },
  });
  t.mock.module("./local-embedding-provider", {
    namedExports: {
      warmUpEmbeddingModel: async () => {
        warmUpCalls++;
      },
    },
  });

  const { runEmbeddingModelWarmUp } = await importFreshWarmup();
  const console_ = captureConsole();

  runEmbeddingModelWarmUp();
  await Promise.resolve();

  console_.restore();
  assert.equal(warmUpCalls, 0);
  assert.equal(console_.logs.length, 0);
  assert.equal(console_.errors.length, 0);
});

test("runEmbeddingModelWarmUp: when enabled, calls warmUpEmbeddingModel exactly once and logs success on completion", async (t) => {
  let warmUpCalls = 0;
  t.mock.module("../config/env", {
    namedExports: { env: { embeddingModelWarmupEnabled: true } },
  });
  t.mock.module("./local-embedding-provider", {
    namedExports: {
      warmUpEmbeddingModel: async () => {
        warmUpCalls++;
      },
    },
  });

  const { runEmbeddingModelWarmUp } = await importFreshWarmup();
  const console_ = captureConsole();

  runEmbeddingModelWarmUp();
  // Fire-and-forget - flush microtasks so the async warmUpEmbeddingModel()
  // call (and its .then/.catch) has actually settled before asserting.
  await Promise.resolve();
  await Promise.resolve();

  console_.restore();
  assert.equal(warmUpCalls, 1);
  assert.equal(console_.errors.length, 0, "a successful warm-up must never log an error");
  assert.ok(
    console_.logs.some((args) => String(args[0]).includes("complete")),
    "a successful warm-up must log completion",
  );
});

test("runEmbeddingModelWarmUp: when enabled and warmUpEmbeddingModel rejects, the failure is caught, logged generically, and never thrown", async (t) => {
  t.mock.module("../config/env", {
    namedExports: { env: { embeddingModelWarmupEnabled: true } },
  });
  t.mock.module("./local-embedding-provider", {
    namedExports: {
      warmUpEmbeddingModel: async () => {
        throw new Error("could not download model weights from example-internal-host.invalid");
      },
    },
  });

  const { runEmbeddingModelWarmUp } = await importFreshWarmup();
  const console_ = captureConsole();

  assert.doesNotThrow(() => runEmbeddingModelWarmUp());
  await Promise.resolve();
  await Promise.resolve();

  console_.restore();
  assert.equal(console_.errors.length, 1);
  // The logged message must be the fixed, generic string - never the
  // underlying error's own message (which could carry an internal host,
  // path, or other detail).
  const loggedMessage = String(console_.errors[0][0]);
  assert.ok(loggedMessage.includes("warm-up failed"));
  assert.equal(loggedMessage.includes("example-internal-host"), false);
});

test("runEmbeddingModelWarmUp: returns synchronously (void), never a Promise the caller must await", async (t) => {
  t.mock.module("../config/env", {
    namedExports: { env: { embeddingModelWarmupEnabled: true } },
  });
  t.mock.module("./local-embedding-provider", {
    namedExports: {
      warmUpEmbeddingModel: async () => {},
    },
  });

  const { runEmbeddingModelWarmUp } = await importFreshWarmup();
  const console_ = captureConsole();

  const result = runEmbeddingModelWarmUp();
  await Promise.resolve();
  await Promise.resolve();

  console_.restore();
  assert.equal(result, undefined);
});
