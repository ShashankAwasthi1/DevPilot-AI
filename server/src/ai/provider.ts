// The one seam every AI-backed feature depends on. A controller/service
// never imports a specific provider's SDK directly - only this interface -
// so adding OpenAI/Gemini later, or extending tool-calling further, never
// requires touching call sites.
//
// streamTurn() is deliberately ONE model round-trip, not a conversation. The
// multi-round tool-calling loop (call -> tool_use -> execute -> tool_result
// -> call again) lives in ai/tool-loop.ts, above this interface - keeping
// AIProvider a clean, swappable per-round primitive.
export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string | ProviderContentBlock[];
}

export interface ProviderToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: string };

export interface StreamTurnParams {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ProviderToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AIProvider {
  readonly name: string;
  streamTurn(params: StreamTurnParams): AsyncGenerator<StreamEvent>;
}
