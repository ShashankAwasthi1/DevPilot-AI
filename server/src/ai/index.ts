import { getAIConfig } from "../config/ai";
import { AnthropicProvider } from "./providers/anthropic.provider";
import type { AIProvider } from "./provider";

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

export type {
  AIProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderToolSpec,
  StreamEvent,
  StreamTurnParams,
} from "./provider";
