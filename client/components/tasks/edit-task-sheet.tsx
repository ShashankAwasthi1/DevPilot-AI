"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { Task, TaskSummary } from "@/lib/types";
import { TaskFormFields, type TaskFormValues } from "./task-form-fields";

interface FieldKnowledge {
  values: TaskFormValues;
  descriptionKnown: boolean;
  assigneeKnown: boolean;
  dueDateKnown: boolean;
}

// The list endpoint only returns TaskSummary (title/status/priority/
// assigneeName) - description/assigneeId/dueDate are only known if this
// exact task was created or edited earlier in this session (see
// useTasks's getCachedTask). When unknown, those fields start blank and
// stay omitted from the update unless the user actually types into them -
// omitted means "don't change" (see task.service.ts's update semantics),
// so an edit never silently wipes a field this form never actually knew.
function buildFieldKnowledge(summary: TaskSummary, cached: Task | undefined): FieldKnowledge {
  return {
    values: {
      title: cached?.title ?? summary.title,
      description: cached?.description ?? "",
      status: cached?.status ?? summary.status,
      priority: cached?.priority ?? summary.priority,
      assigneeId: cached?.assigneeId ?? "",
      // Task.dueDate arrives as a full ISO string; <input type="date">
      // needs just the date portion.
      dueDate: cached?.dueDate ? cached.dueDate.slice(0, 10) : "",
    },
    descriptionKnown: cached !== undefined,
    assigneeKnown: cached !== undefined,
    dueDateKnown: cached !== undefined,
  };
}

interface EditTaskSheetProps {
  task: TaskSummary;
  cachedTask: Task | undefined;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  trigger: ReactNode;
}

export function EditTaskSheet({ task, cachedTask, onUpdate, trigger }: EditTaskSheetProps) {
  const [open, setOpen] = useState(false);
  const [knowledge, setKnowledge] = useState<FieldKnowledge>(() => buildFieldKnowledge(task, cachedTask));
  const [touched, setTouched] = useState({ description: false, assigneeId: false, dueDate: false });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Recompute from the latest summary/cache every time the sheet
      // opens, rather than once on mount - the cache may have gained this
      // task's full detail (or the summary may have changed) since the
      // last time it was opened.
      setKnowledge(buildFieldKnowledge(task, cachedTask));
      setTouched({ description: false, assigneeId: false, dueDate: false });
      setFormError(null);
    }
    setOpen(next);
  }

  function handleFieldChange<K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) {
    setKnowledge((prev) => ({ ...prev, values: { ...prev.values, [field]: value } }));
    if (field === "description" || field === "assigneeId" || field === "dueDate") {
      setTouched((prev) => ({ ...prev, [field]: true }));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = knowledge.values.title.trim();
    if (!trimmedTitle) {
      setFormError("Title is required.");
      return;
    }

    const input: UpdateTaskInput = {
      title: trimmedTitle,
      status: knowledge.values.status,
      priority: knowledge.values.priority,
    };

    if (knowledge.descriptionKnown || touched.description) {
      input.description = knowledge.values.description.trim() ? knowledge.values.description.trim() : null;
    }
    if (knowledge.assigneeKnown || touched.assigneeId) {
      input.assigneeId = knowledge.values.assigneeId.trim() ? knowledge.values.assigneeId.trim() : null;
    }
    if (knowledge.dueDateKnown || touched.dueDate) {
      input.dueDate = knowledge.values.dueDate ? `${knowledge.values.dueDate}T00:00:00.000Z` : null;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onUpdate(task.id, input);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit task</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <TaskFormFields
            idPrefix={`edit-task-${task.id}`}
            values={knowledge.values}
            onChange={handleFieldChange}
            disabled={submitting}
            descriptionHint={
              knowledge.descriptionKnown ? undefined : "Not loaded - leave blank to keep unchanged."
            }
            assigneeHint={knowledge.assigneeKnown ? undefined : "Not loaded - leave blank to keep unchanged."}
            dueDateHint={knowledge.dueDateKnown ? undefined : "Not loaded - leave blank to keep unchanged."}
          />

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
