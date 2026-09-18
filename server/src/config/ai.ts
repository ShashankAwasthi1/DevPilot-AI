// Separate from config/env.ts because these values are load-bearing for one
// feature (AI chat) rather than general server config. Validation is lazy
// (called from inside the provider factory, not at module import time) so a
// missing AI env var fails the first chat request, not the whole server's
// startup - the rest of the app (auth/projects/docs/etc.) must keep working
// even if AI config is absent or wrong.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// A discriminated union (not a single interface with optional fields) so
// that whichever provider getAIProvider() selects only ever sees its own
// required keys typed as definitely-present, never `string | undefined` -
// TypeScript itself enforces that AnthropicProvider can't be constructed
// against a config shaped for Gemini and vice versa. Only the provider
// actually selected by AI_PROVIDER has its variables validated - AI_PROVIDER=
// gemini never requires ANTHROPIC_API_KEY/ANTHROPIC_MODEL, and
// AI_PROVIDER=anthropic never requires GEMINI_API_KEY/GEMINI_MODEL.
export type AIConfig =
  | { provider: "anthropic"; anthropicApiKey: string; anthropicModel: string }
  | { provider: "gemini"; geminiApiKey: string; geminiModel: string };

export function getAIConfig(): AIConfig {
  const provider = process.env.AI_PROVIDER || "anthropic";

  if (provider === "gemini") {
    return {
      provider: "gemini",
      geminiApiKey: requireEnv("GEMINI_API_KEY"),
      geminiModel: requireEnv("GEMINI_MODEL"),
    };
  }

  if (provider === "anthropic") {
    return {
      provider: "anthropic",
      anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
      anthropicModel: requireEnv("ANTHROPIC_MODEL"),
    };
  }

  throw new Error(`Unknown AI_PROVIDER: ${provider}`);
}
