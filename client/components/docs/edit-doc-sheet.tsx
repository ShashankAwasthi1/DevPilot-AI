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
import type { UpdateDocumentInput } from "@/lib/documents";
import type { DocumentItem } from "@/lib/types";
import { DocFormFields, type DocFormValues } from "./doc-form-fields";

interface EditDocSheetProps {
  doc: DocumentItem;
  onUpdate: (documentId: string, input: UpdateDocumentInput) => Promise<DocumentItem>;
  trigger: ReactNode;
}

// Unlike tasks (list-only TaskSummary vs full Task), the documents list
// already returns the full DocumentDto - so this form can populate
// directly from the `doc` prop with no server fetch of its own.
function valuesFromDoc(doc: DocumentItem): DocFormValues {
  return { title: doc.title, content: doc.content };
}

export function EditDocSheet({ doc, onUpdate, trigger }: EditDocSheetProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<DocFormValues>(() => valuesFromDoc(doc));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-sync from the latest prop every time the sheet opens, in case
      // this document was edited elsewhere (another tab, a refresh)
      // since the last time it was opened.
      setValues(valuesFromDoc(doc));
      setError(null);
    }
  }

  function handleFieldChange<K extends keyof DocFormValues>(field: K, value: DocFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
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
      await onUpdate(doc.id, { title: trimmedTitle, content: trimmedContent });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit document</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <DocFormFields
            idPrefix={`edit-doc-${doc.id}`}
            values={values}
            onChange={handleFieldChange}
            disabled={submitting}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

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
