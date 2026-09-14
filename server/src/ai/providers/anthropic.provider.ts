import Anthropic from "@anthropic-ai/sdk";
import { getAIConfig } from "../../config/ai";
import type { AIProvider, StreamReplyParams } from "../provider";

// The only file in the codebase allowed to import the Anthropic SDK -
// everything else depends on the AIProvider interface only, so adding a
// second provider later never touches a controller or service.
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  async *streamReply(params: StreamReplyParams): AsyncGenerator<string> {
    const config = getAIConfig();
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const stream = client.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: params.maxOutputTokens,
        system: params.systemPrompt,
        messages: params.history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      { signal: params.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
