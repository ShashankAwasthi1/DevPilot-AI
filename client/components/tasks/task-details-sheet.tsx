"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { ProjectMember, ProjectRole, Task, TaskSummary } from "@/lib/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "./task-labels";
import { TaskComments } from "./task-comments";

interface TaskDetailsSheetProps {
  task: TaskSummary;
  // Cache-only, synchronous - used purely so an already-known task paints
  // instantly with no loading flicker. fetchTask below is what actually
  // guarantees correctness (see its own doc comment in use-tasks.ts).
  cachedTask: Task | undefined;
  fetchTask: (taskId: string) => Promise<Task>;
  trigger: ReactNode;
  // Phase 20: threaded through only so the Comments section below can
  // resolve comment.authorId -> a display name (members) and gate its
  // composer (projectRole) - see TaskComments. Same project-level members
  // list already passed to every other task sheet in this codebase (see
  // task-form-fields.tsx), never fetched again here.
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
  projectRole: ProjectRole;
}

// GET /tasks/:id (Phase 16 Step 9 Part 9) is now the real source of truth
// for a task's full detail - this no longer silently falls back to "not
// loaded" for a task outside this session's cache. Every open fetches (or
// reuses an already-cached) full Task from the server, so the sheet works
// the same after a hard refresh, for a task created by another user, or
// after navigating away and back.
export function TaskDetailsSheet({
  task,
  cachedTask,
  fetchTask,
  trigger,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
  projectRole,
}: TaskDetailsSheetProps) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Task | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Bumped on every open/close so a response for an obsolete request
  // (sheet closed and reopened before the first fetch resolved) can never
  // overwrite state for the current one.
  const requestIdRef = useRef(0);

  function load() {
    const requestId = ++requestIdRef.current;
    setError(null);
    setLoading(!cachedTask);
    fetchTask(task.id)
      .then((fullTask) => {
        if (requestIdRef.current !== requestId) return;
        setDetail(fullTask);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong."));
        setLoading(false);
      });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Paint instantly from the cache if we have it (no flicker), then
      // still resolve via fetchTask - which itself skips the network call
      // when the cache already has this exact task, so this never turns
      // into a duplicate request.
      setDetail(cachedTask);
      load();
    } else {
      // Invalidate any in-flight request tied to this now-closed view.
      requestIdRef.current += 1;
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="break-words">{task.title}</SheetTitle>
          <SheetDescription>Task details</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{STATUS_LABEL[task.status]}</Badge>
            <Badge variant="outline">{PRIORITY_LABEL[task.priority]}</Badge>
          </div>

          {loading && !detail && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load task details</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{error.message}</span>
                <Button type="button" variant="outline" size="sm" onClick={load}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {detail && !error && (
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Assignee</dt>
                <dd>{task.assigneeName ?? "Not set"}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                <dd className="whitespace-pre-wrap break-words">{detail.description || "Not set"}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Due date</dt>
                <dd>{detail.dueDate ? new Date(detail.dueDate).toLocaleDateString() : "Not set"}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Created</dt>
                <dd>{formatRelativeTime(detail.createdAt)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Last updated</dt>
                <dd>{formatRelativeTime(detail.updatedAt)}</dd>
              </div>
            </dl>
          )}

          <Separator />

          {/* Independent of the task-detail load above - it only needs
              task.id (already known from the TaskSummary prop), so a slow
              or failed task-detail fetch never blocks viewing or adding
              comments. */}
          <TaskComments
            taskId={task.id}
            projectRole={projectRole}
            members={members}
            membersLoading={membersLoading}
            membersError={membersError}
            onRetryMembers={onRetryMembers}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
