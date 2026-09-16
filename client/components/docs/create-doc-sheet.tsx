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
import type { CreateDocumentInput } from "@/lib/documents";
import type { DocumentItem } from "@/lib/types";
import { DocFormFields, type DocFormValues } from "./doc-form-fields";

const EMPTY_VALUES: DocFormValues = { title: "", content: "" };

interface CreateDocSheetProps {
  onCreate: (input: CreateDocumentInput) => Promise<DocumentItem>;
}

// Same Sheet-as-dialog pattern as create-task-sheet.tsx/
// create-project-dialog.tsx - reused rather than introducing a new
// dialog primitive.
export function CreateDocSheet({ onCreate }: CreateDocSheetProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<DocFormValues>(EMPTY_VALUES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFieldChange<K extends keyof DocFormValues>(field: K, value: DocFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setValues(EMPTY_VALUES);
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = values.title.trim();
    const trimmedContent = values.content.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!trimmedContent) {
      setError("Content is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ title: trimmedTitle, content: trimmedContent });
      setValues(EMPTY_VALUES);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" className="gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          New document
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New document</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <DocFormFields
            idPrefix="create-doc"
            values={values}
            onChange={handleFieldChange}
            disabled={submitting}
            autoFocusTitle
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create document"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
