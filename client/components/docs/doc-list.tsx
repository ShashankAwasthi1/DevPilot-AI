"use client";

import { useState, type MouseEvent } from "react";
import { Eye, FileText, Pencil, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { UpdateDocumentInput } from "@/lib/documents";
import type { DocumentItem } from "@/lib/types";
import { DocDetailsSheet } from "./doc-details-sheet";
import { EditDocSheet } from "./edit-doc-sheet";

interface DocListProps {
  documents: DocumentItem[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onUpdate: (documentId: string, input: UpdateDocumentInput) => Promise<DocumentItem>;
  onArchive: (documentId: string) => Promise<DocumentItem>;
  // Set whenever the caller is showing search results rather than the
  // plain list - only changes the empty-state copy below, nothing else
  // about how rows render/behave.
  searchQuery?: string;
}

// Fetching/refresh/mutations live in useDocuments() (consumed by the page
// that renders this) - same split as TaskList vs.
// app/projects/[id]/page.tsx's useTasks().
export function DocList({ documents, loading, error, onRetry, onUpdate, onArchive, searchQuery }: DocListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load documents</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{error.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!documents || documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <FileText className="size-8" aria-hidden="true" />
          {searchQuery ? (
            <p>
              No documents match <span className="font-medium text-foreground">&ldquo;{searchQuery}&rdquo;</span>.
            </p>
          ) : (
            <p>No documents yet.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => (
        <DocRow key={doc.id} doc={doc} onUpdate={onUpdate} onArchive={onArchive} />
      ))}
    </ul>
  );
}

interface DocRowProps {
  doc: DocumentItem;
  onUpdate: (documentId: string, input: UpdateDocumentInput) => Promise<DocumentItem>;
  onArchive: (documentId: string) => Promise<DocumentItem>;
}

// Mirrors ConversationRow's/TaskRow's inline confirm-swap delete pattern -
// the established precedent for destructive-action confirmation in this
// codebase, reused here for archiving rather than a new AlertDialog
// primitive.
function DocRow({ doc, onUpdate, onArchive }: DocRowProps) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  function startConfirmingArchive(event: MouseEvent) {
    event.stopPropagation();
    setArchiveError(null);
    setConfirmingArchive(true);
  }

  function cancelArchive(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingArchive(false);
    setArchiveError(null);
  }

  async function confirmArchive(event: MouseEvent) {
    event.stopPropagation();
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await onArchive(doc.id);
      // On success, the parent's refetch removes this row entirely once
      // it lands (the list only ever returns non-archived documents) -
      // nothing further to do here.
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : "Something went wrong.");
      setArchiving(false);
    }
  }

  if (confirmingArchive) {
    return (
      <li>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm font-medium">Archive document?</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{doc.title}</span> will be archived and removed
              from this list. This won&apos;t delete its history, but it can no longer be edited.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={confirmArchive} disabled={archiving}>
                {archiving ? "Archiving…" : "Archive"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelArchive} disabled={archiving}>
                Cancel
              </Button>
            </div>
            {archiveError && <p className="text-xs text-destructive">{archiveError}</p>}
          </CardContent>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium">{doc.title}</span>
              <span className="block text-xs text-muted-foreground">
                Updated {formatRelativeTime(doc.updatedAt)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DocDetailsSheet
              doc={doc}
              trigger={
                <Button type="button" size="icon-xs" variant="ghost" aria-label="View document">
                  <Eye className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <EditDocSheet
              doc={doc}
              onUpdate={onUpdate}
              trigger={
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Edit document">
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={startConfirmingArchive}
              aria-label="Archive document"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
