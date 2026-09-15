import { getAIConfig } from "../config/ai";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { OpenAIEmbeddingProvider } from "./openai-embedding-provider";
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
    default:
      throw new Error(`Unknown AI_PROVIDER: ${config.provider}`);
  }
}

// The single place that decides which concrete provider backs the
// EmbeddingProvider interface - the same role as getAIProvider above, for
// a deliberately separate capability (embeddings, not generation). Only
// one implementation exists today; this is still the seam a second one
// would plug into later, without touching any caller.
export function getEmbeddingProvider(): EmbeddingProvider {
  return new OpenAIEmbeddingProvider();
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
