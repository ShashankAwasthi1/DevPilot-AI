"use client";

import type { MouseEvent } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { ProjectMember, ProjectRole, Task, TaskSummary } from "@/lib/types";
import { EditTaskSheet } from "./edit-task-sheet";
import { TaskDetailsSheet } from "./task-details-sheet";

interface TaskDeleteConfirmProps {
  title: string;
  deleting: boolean;
  error: string | null;
  onConfirm: (event: MouseEvent) => void;
  onCancel: (event: MouseEvent) => void;
}

// The confirm-swap content shared by TaskRow (List) and the Kanban card -
// same copy/buttons regardless of which view triggered it.
export function TaskDeleteConfirm({ title, deleting, error, onConfirm, onCancel }: TaskDeleteConfirmProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Delete task?</p>
      <p className="text-sm text-muted-foreground">
        This will permanently delete <span className="font-medium text-foreground">{title}</span>. This
        action cannot be undone.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface TaskCardActionsProps {
  task: TaskSummary;
  cachedTask: Task | undefined;
  fetchTask: (taskId: string) => Promise<Task>;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
  // Phase 20: the caller's own role in this project - threaded through
  // only so TaskDetailsSheet's Comments section can gate its composer
  // (VIEWER never sees it). UI gating only; the server remains the sole
  // authority.
  projectRole: ProjectRole;
  onDeleteClick: (event: MouseEvent) => void;
}

// The View/Edit/Delete-trigger button cluster shared by TaskRow (List) and
// the Kanban card - reuses the existing TaskDetailsSheet/EditTaskSheet
// exactly once, rather than either presentation wiring them up separately.
export function TaskCardActions({
  task,
  cachedTask,
  fetchTask,
  onUpdate,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
  projectRole,
  onDeleteClick,
}: TaskCardActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TaskDetailsSheet
        task={task}
        cachedTask={cachedTask}
        fetchTask={fetchTask}
        members={members}
        membersLoading={membersLoading}
        membersError={membersError}
        onRetryMembers={onRetryMembers}
        projectRole={projectRole}
        trigger={
          <Button type="button" size="icon-xs" variant="ghost" aria-label="View task details">
            <Eye className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <EditTaskSheet
        task={task}
        cachedTask={cachedTask}
        fetchTask={fetchTask}
        onUpdate={onUpdate}
        members={members}
        membersLoading={membersLoading}
        membersError={membersError}
        onRetryMembers={onRetryMembers}
        trigger={
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Edit task">
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <Button type="button" size="icon-xs" variant="ghost" onClick={onDeleteClick} aria-label="Delete task">
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
