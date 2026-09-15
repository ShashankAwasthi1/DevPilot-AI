// Separate from config/ai.ts because these values are load-bearing for a
// different feature (embeddings/RAG) than chat (Anthropic). Validation is
// lazy (called from inside the embedding provider, not at module import
// time or from a shared config bundle) so a chat-only request never
// requires OPENAI_API_KEY, and vice versa - same reasoning as config/ai.ts.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface EmbeddingConfig {
  openaiApiKey: string;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  return {
    openaiApiKey: requireEnv("OPENAI_API_KEY"),
  };
}
