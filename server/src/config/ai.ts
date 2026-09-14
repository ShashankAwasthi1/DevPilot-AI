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

export interface AIConfig {
  provider: string;
  anthropicApiKey: string;
  anthropicModel: string;
}

export function getAIConfig(): AIConfig {
  return {
    provider: process.env.AI_PROVIDER || "anthropic",
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    anthropicModel: requireEnv("ANTHROPIC_MODEL"),
  };
}
