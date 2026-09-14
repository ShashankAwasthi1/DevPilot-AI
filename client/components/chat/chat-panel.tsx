"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { streamChatMessage } from "@/lib/ai-chat";
import { useApiData } from "@/lib/use-api-data";
import { ChatInput } from "./chat-input";
import { MessageBubble } from "./message-bubble";
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

    void streamChatMessage(
      projectId,
      conversationId,
      content,
      {
        onDelta: (delta) => {
          setLocalMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: message.content + delta }
                : message,
            ),
          );
        },
        onDone: () => {
          setStreaming(false);
        },
        onError: () => {
          setStreaming(false);
          setLocalMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId ? { ...message, failed: true } : message,
            ),
          );
        },
      },
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
      <ChatInput onSend={handleSend} disabled={streaming} />
    </div>
  );
}
