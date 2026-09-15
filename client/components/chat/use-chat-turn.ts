import { useEffect, useRef, useState } from "react";
import { streamChatMessage, type StreamChatEvent } from "@/lib/ai-chat";
import type { ChatMessageRole } from "@/lib/types";
import type { ChatMode } from "./mode-toggle";
import type { SourceRef } from "./source-footer";
import type { ToolActivityItem } from "./tool-activity";

export interface LocalMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  failed?: boolean;
  // Only ever set on the assistant message currently (or having just
  // finished) streaming in this session - history fetched from the server
  // never has this, since tool calls aren't persisted (see
  // server/src/services/message.service.ts). Scoped per-message rather
  // than as one panel-wide list, so each turn keeps its own activity and a
  // new turn never leaks into or clears a previous one.
  toolActivity?: ToolActivityItem[];
  // Structured RAG citations (Phase 16 Step 5) - same lifecycle as
  // toolActivity above: scoped per-message, never inferred from the
  // message's own text, and only ever populated from "source" SSE events.
  sources?: SourceRef[];
}

interface UseChatTurnOptions {
  projectId: string;
  conversationId: string;
}

interface UseChatTurnResult {
  messages: LocalMessage[];
  streaming: boolean;
  sendMessage: (content: string, mode: ChatMode) => void;
  stop: () => void;
}

export function useChatTurn({ projectId, conversationId }: UseChatTurnOptions): UseChatTurnResult {
  // Messages sent in this session, layered on top of the fetched history -
  // no retry in Phase 12, so a failed turn just stays marked as failed
  // rather than being resent or removed. The parent remounts this component
  // with a new `key` when the conversation changes, so this state naturally
  // resets to [] rather than needing an effect to clear it.
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks which local assistant message the in-flight stream belongs to,
  // so handleStop can update that specific message's tool activity without
  // handleSend needing to lift assistantMessageId into component state.
  const currentAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleSend(content: string, mode: ChatMode) {
    const userMessageId = `local-user-${Date.now()}`;
    const assistantMessageId = `local-assistant-${Date.now()}`;

    setLocalMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "USER", content },
      { id: assistantMessageId, role: "ASSISTANT", content: "" },
    ]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    currentAssistantIdRef.current = assistantMessageId;

    function handleStreamEvent(event: StreamChatEvent) {
      if (event.type === "text") {
        setLocalMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: message.content + event.text }
              : message,
          ),
        );
      } else if (event.type === "tool_call") {
        setLocalMessages((prev) =>
          prev.map((message) => {
            if (message.id !== assistantMessageId) return message;
            const existing = message.toolActivity ?? [];
            const item: ToolActivityItem = {
              // Includes the running count so repeated calls to the same
              // tool within one turn each get their own stable, unique key.
              id: `${assistantMessageId}-tool-${existing.length}`,
              name: event.name,
              status: "running",
            };
            return { ...message, toolActivity: [...existing, item] };
          }),
        );
      } else if (event.type === "tool_result") {
        setLocalMessages((prev) =>
          prev.map((message) => {
            if (message.id !== assistantMessageId || !message.toolActivity) return message;
            // Tool calls execute strictly one at a time, in order (see
            // server/src/ai/tool-loop.ts / agent-runner.ts), and each
            // tool_result always corresponds to the oldest still-running
            // call - the backend's tool_result event has no call id to
            // match against, so this ordering guarantee is what makes
            // matching correct even when the same tool is called twice.
            const index = message.toolActivity.findIndex((item) => item.status === "running");
            if (index === -1) return message;
            const nextActivity = [...message.toolActivity];
            nextActivity[index] = { ...nextActivity[index], status: event.ok ? "success" : "error" };
            return { ...message, toolActivity: nextActivity };
          }),
        );
      } else if (event.type === "source") {
        setLocalMessages((prev) =>
          prev.map((message) => {
            if (message.id !== assistantMessageId) return message;
            const existing = message.sources ?? [];
            const seen = new Set(existing.map((source) => source.documentId));
            const additions = event.sources.filter((source) => !seen.has(source.documentId));
            if (additions.length === 0) return message;
            return { ...message, sources: [...existing, ...additions] };
          }),
        );
      } else if (event.type === "done") {
        setStreaming(false);
        abortRef.current = null;
        currentAssistantIdRef.current = null;
      } else if (event.type === "error") {
        setStreaming(false);
        abortRef.current = null;
        currentAssistantIdRef.current = null;
        setLocalMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId ? { ...message, failed: true } : message,
          ),
        );
      }
    }

    void streamChatMessage(
      projectId,
      conversationId,
      content,
      { mode, onEvent: handleStreamEvent },
      controller.signal,
    );
  }

  // The user intentionally cancelled generation. streamChatMessage's
  // AbortError handling never calls onEvent for an aborted turn (by
  // design - see ai-chat.ts), so nothing there will ever set streaming
  // back to false or touch tool activity for us; this handler is the only
  // place that does it, and it does so unconditionally rather than
  // relying on the stream to notice the cancellation.
  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);

    const assistantId = currentAssistantIdRef.current;
    currentAssistantIdRef.current = null;
    if (!assistantId) return;

    setLocalMessages((prev) =>
      prev.map((message) => {
        if (message.id !== assistantId || !message.toolActivity) return message;
        // Never let a call that was still running when the user stopped
        // read as "success" - it stays visibly incomplete instead.
        const nextActivity = message.toolActivity.map((item) =>
          item.status === "running" ? { ...item, status: "stopped" as const } : item,
        );
        return { ...message, toolActivity: nextActivity };
      }),
    );
  }

  return {
    messages: localMessages,
    streaming,
    sendMessage: handleSend,
    stop: handleStop,
  };
}
