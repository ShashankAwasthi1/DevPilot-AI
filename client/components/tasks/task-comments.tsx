"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { createTaskComment, listTaskComments } from "@/lib/comments";
import { formatRelativeTime } from "@/lib/format";
import type { ProjectMember, ProjectRole, TaskComment } from "@/lib/types";

// Mirrors server/src/services/comment.service.ts's own assertRole(role,
// ["OWNER", "ADMIN", "MEMBER"]) check exactly - UI gating only, so the
// composer is simply never shown to a VIEWER; the server remains the sole
// authority and would reject the POST regardless of what this set says.
const ROLES_THAT_CAN_COMMENT = new Set<ProjectRole>(["OWNER", "ADMIN", "MEMBER"]);
const COMMENT_MAX_LENGTH = 5000;

function memberLabel(member: ProjectMember): string {
  return member.name || member.email;
}

// Never a second network request per comment - resolved entirely from the
// already-fetched, project-level ProjectMember[] (see task-form-fields.tsx
// for the same member || email preference elsewhere in this codebase).
// While that list is still loading, a real author is shown as "Loading…"
// rather than being misreported as unknown.
function resolveAuthorLabel(authorId: string, members: ProjectMember[], membersLoading: boolean): string {
  const member = members.find((m) => m.userId === authorId);
  if (member) return memberLabel(member);
  return membersLoading ? "Loading…" : "Unknown member";
}

function initials(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

interface TaskCommentsProps {
  taskId: string;
  projectRole: ProjectRole;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Self-contained load/retry state, deliberately not lifted into a shared
// hook - this is the only place in the app that needs a task's comments,
// same reasoning TaskDetailsSheet's own load()/retry already follows for
// the task detail fetch just above it.
export function TaskComments({ taskId, projectRole, members, membersLoading, membersError, onRetryMembers }: TaskCommentsProps) {
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Bumped on every load/unmount so a stale response can never overwrite
  // state for a request that's no longer current - same pattern
  // TaskDetailsSheet's own requestIdRef already uses.
  const requestIdRef = useRef(0);

  // Only the actual fetch + its promise-chain state updates - no
  // synchronous setState of its own, so the mount effect below can call it
  // directly without tripping react-hooks/set-state-in-effect. load()
  // below adds the synchronous "reset to loading" step this needs when
  // called from a later event (Retry), which the initial mount doesn't
  // need since `loading`/`error` already start at true/null.
  function fetchComments(requestId: number) {
    listTaskComments(taskId)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setComments(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong."));
        setLoading(false);
      });
  }

  // Retry button handler - resets to a loading state before re-fetching,
  // since by the time this runs the previous attempt may have left `error`
  // set or `loading` false.
  function load() {
    const requestId = ++requestIdRef.current;
    setError(null);
    setLoading(true);
    fetchComments(requestId);
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    fetchComments(requestId);
    return () => {
      requestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const canComment = ROLES_THAT_CAN_COMMENT.has(projectRole);
  const trimmedLength = value.trim().length;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting) return; // never an empty/whitespace-only comment, never a duplicate in-flight submit

    setSubmitting(true);
    setSubmitError(null);
    createTaskComment(taskId, trimmed)
      .then((comment) => {
        // The real server-created comment only - never inserted
        // optimistically before the request resolves.
        setComments((prev) => (prev ? [...prev, comment] : [comment]));
        setValue("");
        setSubmitting(false);
      })
      .catch((err: unknown) => {
        setSubmitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        setSubmitting(false);
      });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">Comments</h3>

      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load comments</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && comments && comments.length === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
          No comments yet.
        </p>
      )}

      {!loading && !error && comments && comments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => {
            const authorLabel = resolveAuthorLabel(comment.authorId, members, membersLoading);
            return (
              <li key={comment.id} className="flex items-start gap-2">
                <Avatar size="sm" className="mt-0.5">
                  <AvatarFallback>{initials(authorLabel)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-sm font-medium">{authorLabel}</span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {membersError && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Member names may be unavailable.</p>
          <Button type="button" variant="ghost" size="xs" onClick={onRetryMembers}>
            Retry
          </Button>
        </div>
      )}

      {canComment && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            disabled={submitting}
            rows={3}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {value.length}/{COMMENT_MAX_LENGTH}
            </span>
            <Button type="submit" size="sm" disabled={submitting || trimmedLength === 0}>
              {submitting ? "Commenting…" : "Comment"}
            </Button>
          </div>
          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        </form>
      )}
    </div>
  );
}
