"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import { ChatInput } from "./chat-input";
import { MessageBubble } from "./message-bubble";
import { ModeToggle, type ChatMode } from "./mode-toggle";
import { PendingActionCard } from "./pending-action-card";
import { SourceFooter } from "./source-footer";
import { ToolActivity } from "./tool-activity";
import { useChatTurn, type LocalMessage } from "./use-chat-turn";
import type { ChatMessage, ConversationSummary } from "@/lib/types";

interface ChatPanelProps {
  projectId: string;
  conversationId: string;
}

export function ChatPanel({ projectId, conversationId }: ChatPanelProps) {
  const { data, loading, error } = useApiData(
    () =>
      api.get<{ conversation: ConversationSummary; messages: ChatMessage[] }>(
        `/projects/${projectId}/conversations/${conversationId}`,
      ),
    [projectId, conversationId],
  );

  // Local-only, per Phase 16 Step 2 scope - not persisted server-side, not
  // reflected in the URL, and reset naturally whenever this component is
  // remounted with a new conversation (same as the hook's messages below).
  const [mode, setMode] = useState<ChatMode>("chat");
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    messages: localMessages,
    streaming,
    sendMessage,
    stop,
    actionStates,
    confirmAction,
    cancelAction,
  } = useChatTurn({
    projectId,
    conversationId,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, data]);

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
            {message.role === "ASSISTANT" && message.pendingAction && (
              <PendingActionCard
                action={message.pendingAction}
                state={actionStates[message.pendingAction.actionId] ?? { status: "pending" }}
                onConfirm={confirmAction}
                onCancel={cancelAction}
              />
            )}
            {message.sources && message.sources.length > 0 && <SourceFooter sources={message.sources} />}
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
        <ChatInput onSend={(content) => sendMessage(content, mode)} onStop={stop} streaming={streaming} />
      </div>
    </div>
  );
}
