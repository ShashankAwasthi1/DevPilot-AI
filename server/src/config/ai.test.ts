import { test } from "node:test";
import assert from "node:assert/strict";
import { getAIConfig } from "./ai";

function clearAIEnv() {
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
}

test("getAIConfig: AI_PROVIDER=gemini requires GEMINI_API_KEY/GEMINI_MODEL and never requires the Anthropic variables", () => {
  clearAIEnv();
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  // Deliberately left unset - must not be required for this provider.
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(process.env.ANTHROPIC_MODEL, undefined);

  const config = getAIConfig();

  assert.deepEqual(config, {
    provider: "gemini",
    geminiApiKey: "test-gemini-key",
    geminiModel: "gemini-2.5-flash",
  });
});

test("getAIConfig: AI_PROVIDER=gemini throws when GEMINI_API_KEY is missing, even if Anthropic variables happen to be set", () => {
  clearAIEnv();
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  process.env.ANTHROPIC_API_KEY = "unused-anthropic-key";
  process.env.ANTHROPIC_MODEL = "unused-anthropic-model";

  assert.throws(() => getAIConfig(), /Missing required environment variable: GEMINI_API_KEY/);
});

test("getAIConfig: AI_PROVIDER=gemini throws when GEMINI_MODEL is missing", () => {
  clearAIEnv();
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  assert.throws(() => getAIConfig(), /Missing required environment variable: GEMINI_MODEL/);
});

test("getAIConfig: AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY/ANTHROPIC_MODEL and never requires the Gemini variables", () => {
  clearAIEnv();
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  assert.equal(process.env.GEMINI_API_KEY, undefined);
  assert.equal(process.env.GEMINI_MODEL, undefined);

  const config = getAIConfig();

  assert.deepEqual(config, {
    provider: "anthropic",
    anthropicApiKey: "test-anthropic-key",
    anthropicModel: "claude-test-model",
  });
});

test("getAIConfig: defaults to anthropic when AI_PROVIDER is unset", () => {
  clearAIEnv();
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_MODEL = "claude-test-model";

  const config = getAIConfig();

  assert.equal(config.provider, "anthropic");
});

test("getAIConfig: throws a clear error for an unrecognized AI_PROVIDER value", () => {
  clearAIEnv();
  process.env.AI_PROVIDER = "not-a-real-provider";

  assert.throws(() => getAIConfig(), /Unknown AI_PROVIDER/);
});
