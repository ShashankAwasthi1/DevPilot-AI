"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLASSNAME } from "./task-form-fields";
import { PRIORITY_LABEL, STATUS_LABEL } from "./task-labels";
import type { TaskPriority, TaskStatus } from "@/lib/types";

export type TaskSort = "LIST_ORDER" | "PRIORITY" | "DUE_DATE" | "TITLE";

export interface TaskFilterState {
  search: string;
  status: TaskStatus | "ALL";
  priority: TaskPriority | "ALL";
  assignee: string | "ALL";
  sort: TaskSort;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = {
  search: "",
  status: "ALL",
  priority: "ALL",
  assignee: "ALL",
  sort: "LIST_ORDER",
};

export function isDefaultTaskFilters(filters: TaskFilterState): boolean {
  return (
    filters.search === DEFAULT_TASK_FILTERS.search &&
    filters.status === DEFAULT_TASK_FILTERS.status &&
    filters.priority === DEFAULT_TASK_FILTERS.priority &&
    filters.assignee === DEFAULT_TASK_FILTERS.assignee &&
    filters.sort === DEFAULT_TASK_FILTERS.sort
  );
}

const SORT_OPTIONS: { value: TaskSort; label: string }[] = [
  { value: "LIST_ORDER", label: "List order" },
  { value: "PRIORITY", label: "Priority" },
  { value: "DUE_DATE", label: "Due date" },
  { value: "TITLE", label: "Title (A–Z)" },
];

interface TaskFiltersProps {
  filters: TaskFilterState;
  onChange: <K extends keyof TaskFilterState>(field: K, value: TaskFilterState[K]) => void;
  assigneeOptions: string[];
  onClear: () => void;
}

// Purely a controls surface - all filtering/sorting logic lives in
// task-list.tsx's useMemo pipeline. No network requests here at all: every
// change is a local state update, matching this part's client-side-only
// architecture decision.
export function TaskFilters({ filters, onChange, assigneeOptions, onClear }: TaskFiltersProps) {
  const canClear = !isDefaultTaskFilters(filters);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-search" className="sr-only">
          Search tasks
        </Label>
        <Input
          id="task-search"
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Search tasks..."
          className="w-full"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-filter-status" className="sr-only">
            Filter by status
          </Label>
          <select
            id="task-filter-status"
            className={`${SELECT_CLASSNAME} w-auto`}
            value={filters.status}
            onChange={(event) => onChange("status", event.target.value as TaskFilterState["status"])}
          >
            <option value="ALL">All statuses</option>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-filter-priority" className="sr-only">
            Filter by priority
          </Label>
          <select
            id="task-filter-priority"
            className={`${SELECT_CLASSNAME} w-auto`}
            value={filters.priority}
            onChange={(event) => onChange("priority", event.target.value as TaskFilterState["priority"])}
          >
            <option value="ALL">All priorities</option>
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </div>

        {assigneeOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-filter-assignee" className="sr-only">
              Filter by assignee
            </Label>
            <select
              id="task-filter-assignee"
              className={`${SELECT_CLASSNAME} w-auto`}
              value={filters.assignee}
              onChange={(event) => onChange("assignee", event.target.value)}
            >
              <option value="ALL">All assignees</option>
              {assigneeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-sort" className="sr-only">
            Sort tasks
          </Label>
          <select
            id="task-sort"
            className={`${SELECT_CLASSNAME} w-auto`}
            value={filters.sort}
            onChange={(event) => onChange("sort", event.target.value as TaskSort)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {canClear && (
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onClear}>
            <X className="size-3.5" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
