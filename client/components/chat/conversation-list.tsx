"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
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
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

// Purely presentational at the list level - fetching, creation, rename,
// and delete all live in the page component, since each needs to update
// the very list this renders (unlike Phase 10's dashboard sections, which
// are read-only and can each safely own an independent fetch). Per-row
// rename/delete UI state is owned by ConversationRow below, not here.
export function ConversationList({
  conversations,
  loading,
  error,
  activeConversationId,
  onSelect,
  onNewChat,
  creating,
  createError,
  onRename,
  onDelete,
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
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ConversationRowProps {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

// Owns all of its own transient rename/delete UI state - kept strictly
// local to each row so no two rows can ever share or interfere with each
// other's editing/saving/confirming state, and so a rename or delete on
// one conversation can never touch anything about another. A row can
// never be simultaneously editing and confirming delete - each state
// renders its own exclusive layout below.
function ConversationRow({ conversation, active, onSelect, onRename, onDelete }: ConversationRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title ?? "");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function startEditing(event: MouseEvent) {
    event.stopPropagation();
    setTitle(conversation.title ?? "");
    setRenameError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setRenameError(null);
    setTitle(conversation.title ?? "");
  }

  async function saveTitle() {
    if (renaming) return; // guard against a duplicate save while one is already in flight
    const trimmed = title.trim();
    if (!trimmed) {
      setRenameError("Title cannot be empty.");
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await onRename(conversation.id, trimmed);
      setEditing(false);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setRenaming(false);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveTitle();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  function startConfirmingDelete(event: MouseEvent) {
    event.stopPropagation();
    setDeleteError(null);
    setConfirmingDelete(true);
  }

  function cancelDelete(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingDelete(false);
    setDeleteError(null);
  }

  async function confirmDelete(event: MouseEvent) {
    event.stopPropagation();
    if (deleting) return; // guard against a duplicate delete while one is already in flight
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(conversation.id);
      // On success, the parent's refetch removes this row entirely once
      // it lands - nothing further to do here, and this instance may
      // unmount shortly after.
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  if (confirmingDelete) {
    return (
      <li className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
        <p className="text-sm">Delete this conversation?</p>
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" variant="destructive" size="sm" onClick={confirmDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Confirm"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={cancelDelete} disabled={deleting}>
            Cancel
          </Button>
        </div>
        {deleteError && <p className="mt-1 text-xs text-destructive">{deleteError}</p>}
      </li>
    );
  }

  if (editing) {
    return (
      <li className="rounded-md px-3 py-2">
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={handleTitleKeyDown}
            disabled={renaming}
            placeholder="Untitled chat"
            maxLength={200}
            aria-label="Conversation title"
            className="h-8 text-sm"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => void saveTitle()}
            disabled={renaming}
            aria-label="Save title"
          >
            <Check className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={cancelEditing}
            disabled={renaming}
            aria-label="Cancel rename"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {renameError && <p className="mt-1 text-xs text-destructive">{renameError}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
          active && "bg-muted font-medium text-foreground",
        )}
      >
        <span className="block truncate">{conversation.title ?? "Untitled chat"}</span>
        <span className="block text-xs text-muted-foreground">
          {formatRelativeTime(conversation.createdAt)}
        </span>
      </button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={startEditing}
        aria-label="Rename conversation"
        className="shrink-0"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={startConfirmingDelete}
        aria-label="Delete conversation"
        className="shrink-0"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}
