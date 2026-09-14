"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ConversationList } from "@/components/chat/conversation-list";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import type { ConversationSummary, SafeUser } from "@/lib/types";

export default function ProjectChatPage(props: PageProps<"/projects/[id]/chat">) {
  const { id: projectId } = use(props.params);
  const router = useRouter();

  const { data: user, loading: authLoading, error: authError } = useApiData(
    () => api.get<{ user: SafeUser }>("/auth/me").then((res) => res.user),
    [],
  );

  useEffect(() => {
    if (!authLoading && authError) {
      router.replace("/login");
    }
  }, [authLoading, authError, router]);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    data: listData,
    loading: listLoading,
    error: listError,
  } = useApiData(
    () => api.get<{ conversations: ConversationSummary[] }>(`/projects/${projectId}/conversations`),
    [projectId, refreshKey],
  );

  // Default to the most recent conversation once the list loads, if the
  // user hasn't explicitly selected/created one yet - derived during render
  // rather than synced via an effect, so there's no extra render pass.
  const effectiveConversationId = activeConversationId ?? listData?.conversations[0]?.id ?? null;

  async function handleNewChat() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.post<{ conversation: ConversationSummary }>(
        `/projects/${projectId}/conversations`,
        {},
      );
      setRefreshKey((key) => key + 1);
      setActiveConversationId(result.conversation.id);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[280px_1fr]">
      <h1 className="sr-only">Project chat</h1>
      <ConversationList
        conversations={listData?.conversations ?? null}
        loading={listLoading}
        error={listError}
        activeConversationId={effectiveConversationId}
        onSelect={setActiveConversationId}
        onNewChat={handleNewChat}
        creating={creating}
        createError={createError}
      />

      <div className="min-h-[28rem] rounded-xl border border-border bg-card p-4">
        {effectiveConversationId ? (
          <ChatPanel
            key={effectiveConversationId}
            projectId={projectId}
            conversationId={effectiveConversationId}
          />
        ) : (
          <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Start a new chat to ask about this project.
          </p>
        )}
      </div>
    </main>
  );
}
