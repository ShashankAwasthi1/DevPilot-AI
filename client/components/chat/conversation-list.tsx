import { MessageSquarePlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/lib/api";
import type { ConversationSummary } from "@/lib/types";

interface ConversationListProps {
  conversations: ConversationSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  creating: boolean;
  createError: string | null;
}

// Purely presentational - fetching and creation both live in the page
// component, since "New chat" needs to update the very list this renders
// (unlike Phase 10's dashboard sections, which are read-only and can each
// safely own an independent fetch).
export function ConversationList({
  conversations,
  loading,
  error,
  activeConversationId,
  onSelect,
  onNewChat,
  creating,
  createError,
}: ConversationListProps) {
  return (
    <div className="flex flex-col gap-3">
      <Button onClick={onNewChat} disabled={creating} className="justify-start gap-2">
        <MessageSquarePlus className="size-4" aria-hidden="true" />
        {creating ? "Starting…" : "New chat"}
      </Button>

      {createError && (
        <Alert variant="destructive">
          <AlertDescription>{createError}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load conversations</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && conversations && conversations.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No conversations yet.
          </CardContent>
        </Card>
      )}

      {!loading && !error && conversations && conversations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                aria-current={conversation.id === activeConversationId ? "true" : undefined}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                  conversation.id === activeConversationId && "bg-muted font-medium text-foreground",
                )}
              >
                <span className="block truncate">{conversation.title ?? "Untitled chat"}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatRelativeTime(conversation.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
