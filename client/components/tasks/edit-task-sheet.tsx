"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import type { UpdateTaskInput } from "@/lib/tasks";
import type { Task, TaskSummary } from "@/lib/types";
import { TaskFormFields, type TaskFormValues } from "./task-form-fields";

function valuesFromTask(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId ?? "",
    // Task.dueDate arrives as a full ISO string; <input type="date">
    // needs just the date portion.
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
  };
}

interface EditTaskSheetProps {
  task: TaskSummary;
  // Cache-only, synchronous - used purely so an already-known task's form
  // prefills instantly with no loading flicker. fetchTask is what
  // guarantees the form is always built from real, current server data.
  cachedTask: Task | undefined;
  fetchTask: (taskId: string) => Promise<Task>;
  onUpdate: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  trigger: ReactNode;
}

// Phase 16 Step 9 Part 9 - the form is only ever shown once populated from
// a real, fully-loaded server Task (via fetchTask/GET /tasks/:id), never
// from TaskSummary alone. This removes Part 7's "known vs unknown field"
// tracking entirely: since every field's true current value is always
// loaded before the form renders, submitting always sends real,
// intentional values (an untouched field round-trips its own current
// value; a cleared field is sent as an explicit null) - there's no longer
// a case where this form doesn't know a field's current value.
export function EditTaskSheet({ task, cachedTask, fetchTask, onUpdate, trigger }: EditTaskSheetProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<TaskFormValues | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bumped on every open/close so a response for an obsolete request
  // (closed and reopened before the first fetch resolved) can never
  // overwrite the form for the current one.
  const requestIdRef = useRef(0);

  function load() {
    const requestId = ++requestIdRef.current;
    setLoadError(null);
    setLoading(!cachedTask);
    fetchTask(task.id)
      .then((fullTask) => {
        if (requestIdRef.current !== requestId) return;
        setValues(valuesFromTask(fullTask));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setLoadError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong."));
        setLoading(false);
      });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFormError(null);
      // Paint instantly from the cache if available (no flicker); fetchTask
      // itself skips the network call when the cache already has this
      // exact task, so this never becomes a duplicate request.
      setValues(cachedTask ? valuesFromTask(cachedTask) : null);
      load();
    } else {
      // Invalidate any in-flight request tied to this now-closed sheet.
      requestIdRef.current += 1;
    }
  }

  function handleFieldChange<K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) {
    setValues((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !values) return;

    const trimmedTitle = values.title.trim();
    if (!trimmedTitle) {
      setFormError("Title is required.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onUpdate(task.id, {
        title: trimmedTitle,
        status: values.status,
        priority: values.priority,
        description: values.description.trim() ? values.description.trim() : null,
        assigneeId: values.assigneeId.trim() ? values.assigneeId.trim() : null,
        dueDate: values.dueDate ? `${values.dueDate}T00:00:00.000Z` : null,
      });
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

        {loading && !values && (
          <div className="flex flex-col gap-4 px-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {loadError && (
          <div className="px-4">
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load this task</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{loadError.message}</span>
                <Button type="button" variant="outline" size="sm" onClick={load}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {values && !loadError && (
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
            <TaskFormFields
              idPrefix={`edit-task-${task.id}`}
              values={values}
              onChange={handleFieldChange}
              disabled={submitting}
            />

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
