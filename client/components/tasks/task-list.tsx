"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ListTodo } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { ProjectMember, Task, TaskSummary } from "@/lib/types";
import { TaskCardActions, TaskDeleteConfirm } from "./task-card-shared";
import { TaskKanban } from "./task-kanban";
import { TaskViewToggle, type TaskView } from "./task-view-toggle";
import { useTaskDeleteConfirm } from "./use-task-delete-confirm";
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, PRIORITY_SORT_ORDER, STATUS_BADGE_VARIANT, STATUS_LABEL } from "./task-labels";
import { DEFAULT_TASK_FILTERS, TaskFilters, type TaskFilterState } from "./task-filters";

// Search/filter/sort happen entirely client-side over the already-loaded,
// server-bounded (limit<=50) list - see this part's report for the full
// rationale. No new network request is ever made for a keystroke or a
// filter change.
function filterAndSortTasks(
  tasks: TaskSummary[],
  filters: TaskFilterState,
  getCachedTask: (taskId: string) => Task | undefined,
): TaskSummary[] {
  const query = filters.search.trim().toLowerCase();

  let result = tasks;
  if (query) {
    result = result.filter((task) => task.title.toLowerCase().includes(query));
  }
  if (filters.status !== "ALL") {
    result = result.filter((task) => task.status === filters.status);
  }
  if (filters.priority !== "ALL") {
    result = result.filter((task) => task.priority === filters.priority);
  }
  if (filters.assignee !== "ALL") {
    result = result.filter((task) => task.assigneeName === filters.assignee);
  }

  // Copy before sorting - the array returned by useTasks/useApiData must
  // never be mutated in place.
  const sorted = [...result];

  if (filters.sort === "PRIORITY") {
    sorted.sort((a, b) => PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority]);
  } else if (filters.sort === "TITLE") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  } else if (filters.sort === "DUE_DATE") {
    // TaskSummary has no dueDate at all - only tasks cached from a real
    // create/update response (see useTasks's getCachedTask) have a known
    // due date. Tasks with a known due date sort ascending; every other
    // task (genuinely no due date, or simply not loaded yet) sorts after
    // them, keeping their existing relative order (Array#sort is stable).
    sorted.sort((a, b) => {
      const aDue = getCachedTask(a.id)?.dueDate ?? null;
      const bDue = getCachedTask(b.id)?.dueDate ?? null;
      if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime();
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return 0;
    });
  }
  // "LIST_ORDER" (the default) intentionally does not reorder at all - see
  // this part's report for why Newest/Oldest were not implemented as
  // sort options.

  return sorted;
}

interface TaskListProps {
  tasks: TaskSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  // Cache-only, synchronous - used for Part 8's due-date sort (never
  // triggers a request) and for instant-paint in the details/edit sheets.
  getCachedTask: (taskId: string) => Task | undefined;
  // Server-backed - the actual source of truth for a single full Task
  // (GET /tasks/:id, Phase 16 Step 9 Part 9). Passed through to the
  // details/edit sheets rather than fetched here, since each row's sheet
  // only needs it once opened.
  fetchTask: (taskId: string) => Promise<Task>;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  onDelete: (taskId: string) => Promise<void>;
  // One project-level members fetch (see app/projects/[id]/page.tsx's
  // useProjectMembers) - passed through to each row's EditTaskSheet
  // rather than fetched per-row, so opening N rows' edit forms never
  // becomes N requests for the same project's member list.
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Fetching/refresh/mutations live in useTasks() (consumed by the page that
// renders this) - same split as ConversationList vs. its page.tsx owner.
// Search/filter/sort state is owned here, since it's pure client-side
// presentation over whatever useTasks already loaded - it never needs to
// be lifted to the page.
export function TaskList({
  tasks,
  loading,
  error,
  onRetry,
  getCachedTask,
  fetchTask,
  onUpdate,
  onDelete,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
}: TaskListProps) {
  const [filters, setFilters] = useState<TaskFilterState>(DEFAULT_TASK_FILTERS);
  // Client-side UI state only - never persisted, never a URL param (the
  // existing task workspace doesn't use query params for view state
  // anywhere else). Defaults to List, per this part's spec.
  const [view, setView] = useState<TaskView>("list");

  const assigneeOptions = useMemo(() => {
    if (!tasks) return [];
    const names = new Set<string>();
    for (const task of tasks) {
      if (task.assigneeName) names.add(task.assigneeName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tasks]);

  const displayedTasks = useMemo(() => {
    if (!tasks) return [];
    return filterAndSortTasks(tasks, filters, getCachedTask);
  }, [tasks, filters, getCachedTask]);

  function handleFilterChange<K extends keyof TaskFilterState>(field: K, value: TaskFilterState[K]) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function handleClearFilters() {
    setFilters(DEFAULT_TASK_FILTERS);
  }

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
    <div className="flex flex-col gap-3">
      <TaskFilters
        filters={filters}
        onChange={handleFilterChange}
        assigneeOptions={assigneeOptions}
        onClear={handleClearFilters}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {displayedTasks.length === tasks.length
            ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`
            : `Showing ${displayedTasks.length} of ${tasks.length} tasks`}
        </p>
        <TaskViewToggle view={view} onViewChange={setView} />
      </div>

      {displayedTasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
            <ListTodo className="size-8" aria-hidden="true" />
            <p>No tasks match your current search and filters.</p>
            <Button type="button" variant="outline" size="sm" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : view === "list" ? (
        <ul className="flex flex-col gap-2">
          {displayedTasks.map((task) => (
            <TaskRow
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
          ))}
        </ul>
      ) : (
        <TaskKanban
          tasks={displayedTasks}
          getCachedTask={getCachedTask}
          fetchTask={fetchTask}
          onUpdate={onUpdate}
          onDelete={onDelete}
          members={members}
          membersLoading={membersLoading}
          membersError={membersError}
          onRetryMembers={onRetryMembers}
        />
      )}
    </div>
  );
}

interface TaskRowProps {
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

// Mirrors ConversationRow's (Phase 16 Step 8) inline confirm-swap delete
// pattern - the established precedent for delete confirmation in this
// codebase. Delete-confirm state and the View/Edit/Delete-trigger cluster
// now live in use-task-delete-confirm.ts/task-card-shared.tsx so the
// Kanban card (task-kanban.tsx) can reuse the exact same behavior instead
// of a second implementation.
function TaskRow({
  task,
  cachedTask,
  fetchTask,
  onUpdate,
  onDelete,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
}: TaskRowProps) {
  const { confirming, deleting, error, start, cancel, confirm } = useTaskDeleteConfirm(task.id, onDelete);

  if (confirming) {
    return (
      <li>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent>
            <TaskDeleteConfirm title={task.title} deleting={deleting} error={error} onConfirm={confirm} onCancel={cancel} />
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
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
