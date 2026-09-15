"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TaskPriority, TaskStatus } from "@/lib/types";

// Native <select> elements, styled to match Input's own tokens - there is
// no shadcn Select primitive in this codebase yet, and adding one is out
// of scope for this focused step (see components/ui/ - only Sheet exists,
// reused for both the create and edit forms rather than building a new
// dialog primitive).
export const SELECT_CLASSNAME =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

export const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "DONE", label: "Done" },
];

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

export interface TaskFormValues {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  dueDate: string;
}

interface TaskFormFieldsProps {
  idPrefix: string;
  values: TaskFormValues;
  onChange: <K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) => void;
  disabled: boolean;
  autoFocusTitle?: boolean;
  // Shown under description/assignee/due date when this form's caller
  // doesn't actually know the task's current value for that field (see
  // EditTaskSheet) - never fabricated, just an honest "we don't know"
  // notice, and leaving the field blank in that case omits it from the
  // update entirely (undefined = "don't change", per task.service.ts's
  // update semantics) rather than clearing it.
  descriptionHint?: string;
  assigneeHint?: string;
  dueDateHint?: string;
}

// Shared field set for both CreateTaskSheet and EditTaskSheet, so the two
// forms can't silently drift apart - only the surrounding Sheet, submit
// handler, and initial values differ between them.
export function TaskFormFields({
  idPrefix,
  values,
  onChange,
  disabled,
  autoFocusTitle,
  descriptionHint,
  assigneeHint,
  dueDateHint,
}: TaskFormFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          value={values.title}
          onChange={(event) => onChange("title", event.target.value)}
          maxLength={200}
          required
          disabled={disabled}
          autoFocus={autoFocusTitle}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={values.description}
          onChange={(event) => onChange("description", event.target.value)}
          maxLength={10000}
          disabled={disabled}
          placeholder="Optional"
        />
        {descriptionHint && <p className="text-xs text-muted-foreground">{descriptionHint}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-status`}>Status</Label>
          <select
            id={`${idPrefix}-status`}
            className={SELECT_CLASSNAME}
            value={values.status}
            onChange={(event) => onChange("status", event.target.value as TaskStatus)}
            disabled={disabled}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <select
            id={`${idPrefix}-priority`}
            className={SELECT_CLASSNAME}
            value={values.priority}
            onChange={(event) => onChange("priority", event.target.value as TaskPriority)}
            disabled={disabled}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-assignee`}>Assignee user ID</Label>
        <Input
          id={`${idPrefix}-assignee`}
          value={values.assigneeId}
          onChange={(event) => onChange("assigneeId", event.target.value)}
          disabled={disabled}
          placeholder="Optional"
        />
        {assigneeHint && <p className="text-xs text-muted-foreground">{assigneeHint}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-due-date`}>Due date</Label>
        <Input
          id={`${idPrefix}-due-date`}
          type="date"
          value={values.dueDate}
          onChange={(event) => onChange("dueDate", event.target.value)}
          disabled={disabled}
        />
        {dueDateHint && <p className="text-xs text-muted-foreground">{dueDateHint}</p>}
      </div>
    </>
  );
}
