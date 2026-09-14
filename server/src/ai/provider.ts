// The one seam every AI-backed feature depends on. A controller/service
// never imports a specific provider's SDK directly - only this interface -
// so adding OpenAI/Gemini later, or extending this with tool-calling in a
// future phase, never requires touching call sites.
export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface StreamReplyParams {
  systemPrompt: string;
  history: ChatMessageInput[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AIProvider {
  readonly name: string;
  streamReply(params: StreamReplyParams): AsyncGenerator<string>;
}
