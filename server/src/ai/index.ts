import { getAIConfig } from "../config/ai";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { GeminiProvider } from "./providers/gemini.provider";
import { LocalEmbeddingProvider } from "./local-embedding-provider";
import type { AIProvider } from "./provider";
import type { EmbeddingProvider } from "./embedding-provider";

// The single place that decides which concrete provider backs the AIProvider
// interface. Every caller goes through this factory instead of constructing
// a provider directly, so a future OpenAI/Gemini provider is a new branch
// here, not a change anywhere else.
export function getAIProvider(): AIProvider {
  const config = getAIConfig();

  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    default:
      // Unreachable: getAIConfig() only ever returns "anthropic" or
      // "gemini" (or throws for anything else) - kept as a defensive,
      // exhaustiveness-checked fallback rather than an assumption.
      throw new Error("Unknown AI_PROVIDER");
  }
}

// The single place that decides which concrete provider backs the
// EmbeddingProvider interface - the same role as getAIProvider above, for
// a deliberately separate capability (embeddings, not generation). Runs
// fully locally (no API key, no paid usage) so RAG works out of the box;
// this is still the seam a second implementation would plug into later,
// without touching any caller.
export function getEmbeddingProvider(): EmbeddingProvider {
  return new LocalEmbeddingProvider();
}

export type {
  AIProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderToolSpec,
  StreamEvent,
  StreamTurnParams,
} from "./provider";
export type { EmbeddingProvider } from "./embedding-provider";
