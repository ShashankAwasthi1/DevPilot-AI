import { API_URL } from "./api";

// Mirrors the server's TurnEvent | AgentTurnEvent union (see
// server/src/ai/tool-loop.ts and server/src/ai/agent-runner.ts) - a single
// discriminated event type scales to both chat and agent mode without a
// growing list of positional callbacks.
export type StreamChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

export interface StreamChatOptions {
  // Defaults to "chat" below so a caller that omits this keeps exercising
  // exactly the same server-side path (runChatTurn) as before this option
  // existed - existing behavior is unchanged unless a caller opts in.
  mode?: "chat" | "agent";
  onEvent: (event: StreamChatEvent) => void;
}

// Separate from api.ts's request() helper because that awaits a full JSON
// body - this reads the response incrementally as Server-Sent Events
// arrive. Uses the same credentials/base-URL convention as api.ts, but a
// raw fetch + stream reader instead of response.json().
export async function streamChatMessage(
  projectId: string,
  conversationId: string,
  content: string,
  options: StreamChatOptions,
  signal?: AbortSignal,
): Promise<void> {
  const mode = options.mode ?? "chat";
  const { onEvent } = options;

  let response: Response;

  try {
    response = await fetch(
      `${API_URL}/projects/${projectId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode }),
        signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    onEvent({ type: "error", message: "Could not reach the server. Check your connection." });
    return;
  }

  if (!response.ok || !response.body) {
    let message = "Something went wrong.";
    try {
      const body = (await response.json()) as { message?: string };
      message = body?.message ?? message;
    } catch {
      // Non-JSON error body - fall back to the generic message.
    }
    onEvent({ type: "error", message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;

        if (parsed.event === "done") {
          onEvent({ type: "done" });
          return;
        }

        if (parsed.event === "error") {
          const data = parsed.data ? (JSON.parse(parsed.data) as { message?: string }) : {};
          onEvent({ type: "error", message: data.message ?? "Something went wrong generating a response." });
          return;
        }

        if (parsed.event === "tool_call") {
          if (!parsed.data) continue;
          // Forward exactly the two safe fields the backend sends - never
          // more, never a raw tool result (the backend itself never sends
          // one in this event).
          const data = JSON.parse(parsed.data) as { name?: string; input?: unknown };
          if (typeof data.name === "string") {
            onEvent({ type: "tool_call", name: data.name, input: data.input });
          }
          continue;
        }

        if (parsed.event === "tool_result") {
          if (!parsed.data) continue;
          // Same safety guarantee as tool_call - name + ok only.
          const data = JSON.parse(parsed.data) as { name?: string; ok?: boolean };
          if (typeof data.name === "string" && typeof data.ok === "boolean") {
            onEvent({ type: "tool_result", name: data.name, ok: data.ok });
          }
          continue;
        }

        if (parsed.data) {
          const data = JSON.parse(parsed.data) as { delta?: string };
          if (typeof data.delta === "string") {
            onEvent({ type: "text", text: data.delta });
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    onEvent({ type: "error", message: "Something went wrong generating a response." });
    return;
  }

  onEvent({ type: "done" });
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  if (!frame.trim()) return null;

  let event = "message";
  let data = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data = line.slice(6);
  }

  return { event, data };
}
