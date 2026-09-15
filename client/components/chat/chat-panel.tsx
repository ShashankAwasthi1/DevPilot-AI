"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { streamChatMessage, type StreamChatEvent } from "@/lib/ai-chat";
import { useApiData } from "@/lib/use-api-data";
import { ChatInput } from "./chat-input";
import { MessageBubble } from "./message-bubble";
import { ModeToggle, type ChatMode } from "./mode-toggle";
import { ToolActivity, type ToolActivityItem } from "./tool-activity";
import type { ChatMessage, ChatMessageRole, ConversationSummary } from "@/lib/types";

interface ChatPanelProps {
  projectId: string;
  conversationId: string;
}

interface LocalMessage {
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
}

export function ChatPanel({ projectId, conversationId }: ChatPanelProps) {
  const { data, loading, error } = useApiData(
    () =>
      api.get<{ conversation: ConversationSummary; messages: ChatMessage[] }>(
        `/projects/${projectId}/conversations/${conversationId}`,
      ),
    [projectId, conversationId],
  );

  // Messages sent in this session, layered on top of the fetched history -
  // no retry in Phase 12, so a failed turn just stays marked as failed
  // rather than being resent or removed. The parent remounts this component
  // with a new `key` when the conversation changes, so this state naturally
  // resets to [] rather than needing an effect to clear it.
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Local-only, per Phase 16 Step 2 scope - not persisted server-side, not
  // reflected in the URL, and reset naturally whenever this component is
  // remounted with a new conversation (same as localMessages below).
  const [mode, setMode] = useState<ChatMode>("chat");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, data]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleSend(content: string) {
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
      } else if (event.type === "done") {
        setStreaming(false);
      } else if (event.type === "error") {
        setStreaming(false);
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

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-1/2" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this conversation</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  const historyMessages: LocalMessage[] =
    data?.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    })) ?? [];
  const allMessages = [...historyMessages, ...localMessages];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {allMessages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Ask a question about this project to get started.
          </p>
        )}
        {allMessages.map((message) => (
          <div key={message.id}>
            {message.toolActivity && message.toolActivity.length > 0 && (
              <ToolActivity items={message.toolActivity} />
            )}
            <MessageBubble role={message.role} content={message.content} />
            {message.failed && (
              <p className="mt-1 text-right text-xs text-destructive">
                This response failed to generate.
              </p>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ModeToggle mode={mode} onModeChange={setMode} disabled={streaming} />
          {mode === "agent" && (
            <p className="text-xs text-muted-foreground">
              Agent mode may take longer and can use project tools.
            </p>
          )}
        </div>
        <ChatInput onSend={handleSend} disabled={streaming} />
      </div>
    </div>
  );
}
