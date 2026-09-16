"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { ProjectMember, Task, TaskStatus, TaskSummary } from "@/lib/types";
import { TaskCardActions, TaskDeleteConfirm } from "./task-card-shared";
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, STATUS_LABEL } from "./task-labels";
import { useTaskDeleteConfirm } from "./use-task-delete-confirm";

// Declared in the same order the columns render - reused for both the
// column list and each column's header label.
const COLUMNS: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

interface TaskKanbanProps {
  // Already filtered AND sorted by task-list.tsx's own pipeline - this
  // component never re-filters or re-sorts, only groups by status while
  // preserving the incoming order within each group. Callers only ever
  // pass a non-empty array; the "no tasks match your filters" case is
  // handled once, by task-list.tsx, above this component.
  tasks: TaskSummary[];
  getCachedTask: (taskId: string) => Task | undefined;
  fetchTask: (taskId: string) => Promise<Task>;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  onDelete: (taskId: string) => Promise<void>;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Four-column board over the exact same task collection task-list.tsx's
// List view renders - no independent fetch, no independent filter/sort
// implementation. Mobile: a horizontally scrollable row of fixed-width
// columns. Desktop (lg+): a four-column grid, no horizontal scroll needed.
// Columns grow with their content rather than getting their own vertical
// scrollbar, to avoid nested page scrolling.
export function TaskKanban({
  tasks,
  getCachedTask,
  fetchTask,
  onUpdate,
  onDelete,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
}: TaskKanbanProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
      {COLUMNS.map((status) => {
        // Array#filter preserves relative order - this never re-sorts.
        const columnTasks = tasks.filter((task) => task.status === status);

        return (
          <div key={status} className="flex w-72 shrink-0 flex-col gap-2 lg:w-auto">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h3 className="text-sm font-medium text-foreground">{STATUS_LABEL[status]}</h3>
              <span className="text-xs text-muted-foreground">
                {columnTasks.length} task{columnTasks.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {columnTasks.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center text-xs text-muted-foreground">No tasks</CardContent>
                </Card>
              ) : (
                columnTasks.map((task) => (
                  <TaskKanbanCard
                    key={task.id}
                    task={task}
                    cachedTask={getCachedTask(task.id)}
                    fetchTask={fetchTask}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    members={members}
                    membersLoading={membersLoading}
                    membersError={membersError}
                    onRetryMembers={onRetryMembers}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TaskKanbanCardProps {
  task: TaskSummary;
  cachedTask: Task | undefined;
  fetchTask: (taskId: string) => Promise<Task>;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  onDelete: (taskId: string) => Promise<void>;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Presentation-only in Part 11A - no drag/drop, no pointer-driven status
// mutation. View/Edit/Delete reuse the exact same
// TaskDetailsSheet/EditTaskSheet/delete-confirm behavior as the List row
// (task-list.tsx's TaskRow), via the shared task-card-shared.tsx pieces
// and use-task-delete-confirm.ts hook - not a second implementation.
function TaskKanbanCard({
  task,
  cachedTask,
  fetchTask,
  onUpdate,
  onDelete,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
}: TaskKanbanCardProps) {
  const { confirming, deleting, error, start, cancel, confirm } = useTaskDeleteConfirm(task.id, onDelete);

  if (confirming) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent>
          <TaskDeleteConfirm title={task.title} deleting={deleting} error={error} onConfirm={confirm} onCancel={cancel} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <p
          className={cn(
            "text-sm font-medium break-words",
            task.status === "DONE" && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>

        {/* No status badge here - the column itself already conveys
            status; repeating it on every card would be visual noise. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
        </div>

        {task.assigneeName && <p className="text-xs text-muted-foreground">Assigned to {task.assigneeName}</p>}

        <TaskCardActions
          task={task}
          cachedTask={cachedTask}
          fetchTask={fetchTask}
          onUpdate={onUpdate}
          members={members}
          membersLoading={membersLoading}
          membersError={membersError}
          onRetryMembers={onRetryMembers}
          onDeleteClick={start}
        />
      </CardContent>
    </Card>
  );
}
