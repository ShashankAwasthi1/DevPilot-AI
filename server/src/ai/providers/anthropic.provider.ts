import Anthropic from "@anthropic-ai/sdk";
import { getAIConfig } from "../../config/ai";
import type {
  AIProvider,
  ProviderContentBlock,
  ProviderMessage,
  StreamEvent,
  StreamTurnParams,
} from "../provider";

// The only file in the codebase allowed to import the Anthropic SDK -
// everything else depends on the AIProvider interface only, so adding a
// second provider later never touches a controller, service, or the
// tool-loop orchestrator.
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  async *streamTurn(params: StreamTurnParams): AsyncGenerator<StreamEvent> {
    const config = getAIConfig();
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const stream = client.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: params.maxOutputTokens,
        system: params.systemPrompt,
        messages: params.messages.map(toAnthropicMessage),
        // Omitted entirely (not sent as []) when no tools are offered this
        // round - this is what makes it structurally impossible for the
        // model to return a tool_use block on a tool-free round.
        ...(params.tools.length > 0
          ? {
              tools: params.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      { signal: params.signal },
    );

    // Real-time text deltas as they arrive, for live streaming to the
    // client - the low-level async-iterable gives us this without waiting
    // for the whole turn to finish.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    // finalMessage() resolves from the same already-completed request (the
    // iteration above has already fully drained the stream) and gives us
    // fully-parsed content blocks - including complete tool_use blocks with
    // already-parsed `input` - instead of hand-accumulating input_json_delta
    // fragments ourselves.
    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        yield { type: "tool_use", id: block.id, name: block.name, input: block.input };
      }
    }

    yield { type: "stop", reason: finalMessage.stop_reason ?? "end_turn" };
  }
}

function toAnthropicMessage(message: ProviderMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(block: ProviderContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}
