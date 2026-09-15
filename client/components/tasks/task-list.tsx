"use client";

import { useState, type MouseEvent } from "react";
import { CheckCircle2, Eye, ListTodo, Pencil, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { Task, TaskPriority, TaskStatus, TaskSummary } from "@/lib/types";
import { EditTaskSheet } from "./edit-task-sheet";
import { TaskDetailsSheet } from "./task-details-sheet";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};

const STATUS_BADGE_VARIANT: Record<TaskStatus, "outline" | "secondary" | "default"> = {
  TODO: "outline",
  IN_PROGRESS: "secondary",
  IN_REVIEW: "secondary",
  DONE: "default",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

const PRIORITY_BADGE_VARIANT: Record<TaskPriority, "outline" | "secondary" | "destructive"> = {
  LOW: "outline",
  MEDIUM: "outline",
  HIGH: "secondary",
  URGENT: "destructive",
};

interface TaskListProps {
  tasks: TaskSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  getCachedTask: (taskId: string) => Task | undefined;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  onDelete: (taskId: string) => Promise<void>;
}

// Purely presentational - fetching/refresh/mutations live in useTasks()
// (consumed by the page that renders this), same split as
// ConversationList vs. its page.tsx owner.
export function TaskList({ tasks, loading, error, onRetry, getCachedTask, onUpdate, onDelete }: TaskListProps) {
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
        <AlertTitle>Couldn&apos;t load tasks</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{error.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <ListTodo className="size-8" aria-hidden="true" />
          <p>No tasks yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          cachedTask={getCachedTask(task.id)}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

interface TaskRowProps {
  task: TaskSummary;
  cachedTask: Task | undefined;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  onDelete: (taskId: string) => Promise<void>;
}

// Mirrors ConversationRow's (Phase 16 Step 8) inline confirm-swap delete
// pattern - the established precedent for delete confirmation in this
// codebase, reused here rather than introducing a new AlertDialog
// primitive (none exists yet, and this part is meant to stay focused).
function TaskRow({ task, cachedTask, onUpdate, onDelete }: TaskRowProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(task.id);
      // On success, the parent's refetch removes this row entirely once
      // it lands - nothing further to do here.
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  if (confirmingDelete) {
    return (
      <li>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm font-medium">Delete task?</p>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-medium text-foreground">{task.title}</span>.
              This action cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelDelete} disabled={deleting}>
                Cancel
              </Button>
            </div>
            {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
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
            {task.status === "DONE" && (
              <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span
              className={cn(
                "truncate text-sm font-medium",
                task.status === "DONE" && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={STATUS_BADGE_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
              <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
              {task.assigneeName && <span>Assigned to {task.assigneeName}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <TaskDetailsSheet
                task={task}
                cachedTask={cachedTask}
                trigger={
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="View task details">
                    <Eye className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              />
              <EditTaskSheet
                task={task}
                cachedTask={cachedTask}
                onUpdate={onUpdate}
                trigger={
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Edit task">
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              />
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={startConfirmingDelete}
                aria-label="Delete task"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
