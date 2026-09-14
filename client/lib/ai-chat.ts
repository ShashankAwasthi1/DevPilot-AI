import { API_URL } from "./api";

export interface StreamChatCallbacks {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// Separate from api.ts's request() helper because that awaits a full JSON
// body - this reads the response incrementally as Server-Sent Events
// arrive. Uses the same credentials/base-URL convention as api.ts, but a
// raw fetch + stream reader instead of response.json().
export async function streamChatMessage(
  projectId: string,
  conversationId: string,
  content: string,
  callbacks: StreamChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(
      `${API_URL}/projects/${projectId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    callbacks.onError("Could not reach the server. Check your connection.");
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
    callbacks.onError(message);
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
          callbacks.onDone();
          return;
        }

        if (parsed.event === "error") {
          const data = parsed.data ? (JSON.parse(parsed.data) as { message?: string }) : {};
          callbacks.onError(data.message ?? "Something went wrong generating a response.");
          return;
        }

        if (parsed.data) {
          const data = JSON.parse(parsed.data) as { delta?: string };
          if (typeof data.delta === "string") {
            callbacks.onDelta(data.delta);
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    callbacks.onError("Something went wrong generating a response.");
    return;
  }

  callbacks.onDone();
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
