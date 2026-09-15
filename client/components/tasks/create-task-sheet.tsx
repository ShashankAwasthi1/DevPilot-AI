"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import type { CreateTaskInput } from "@/lib/tasks";
import type { Task, ProjectMember } from "@/lib/types";
import { TaskFormFields, type TaskFormValues } from "./task-form-fields";

const EMPTY_VALUES: TaskFormValues = {
  title: "",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: "",
  dueDate: "",
};

interface CreateTaskSheetProps {
  onCreate: (input: CreateTaskInput) => Promise<Task>;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Phase 16 Step 9 Part 10 - assigneeId is now selected from the project's
// real members (see task-form-fields.tsx) rather than typed as a free-text
// user id.
export function CreateTaskSheet({
  onCreate,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
}: CreateTaskSheetProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<TaskFormValues>(EMPTY_VALUES);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleFieldChange<K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = values.title.trim();
    if (!trimmedTitle) {
      setFormError("Title is required.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onCreate({
        title: trimmedTitle,
        description: values.description.trim() ? values.description.trim() : undefined,
        status: values.status,
        priority: values.priority,
        assigneeId: values.assigneeId.trim() ? values.assigneeId.trim() : undefined,
        // <input type="date"> only gives a bare "YYYY-MM-DD" - the API
        // requires a full ISO datetime (see task.validation.ts), so
        // midnight UTC is appended here. This is wire-format shaping, not
        // business logic - the server remains the sole authority on
        // whether the value is acceptable.
        dueDate: values.dueDate ? `${values.dueDate}T00:00:00.000Z` : undefined,
      });
      setValues(EMPTY_VALUES);
      setFormError(null);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" className="gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          Create task
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create task</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <TaskFormFields
            idPrefix="create-task"
            values={values}
            onChange={handleFieldChange}
            disabled={submitting}
            autoFocusTitle
            members={members}
            membersLoading={membersLoading}
            membersError={membersError}
            onRetryMembers={onRetryMembers}
          />

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create task"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
