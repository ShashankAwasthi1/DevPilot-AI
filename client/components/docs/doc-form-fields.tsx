"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface DocFormValues {
  title: string;
  content: string;
}

interface DocFormFieldsProps {
  idPrefix: string;
  values: DocFormValues;
  onChange: <K extends keyof DocFormValues>(field: K, value: DocFormValues[K]) => void;
  disabled: boolean;
  autoFocusTitle?: boolean;
}

// Shared field set for both CreateDocSheet and EditDocSheet, matching the
// existing task-form-fields.tsx split (one shared presentational field
// set, each sheet owns its own surrounding form/submit logic).
export function DocFormFields({ idPrefix, values, onChange, disabled, autoFocusTitle }: DocFormFieldsProps) {
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

      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-content`}>Content</Label>
        <Textarea
          id={`${idPrefix}-content`}
          value={values.content}
          onChange={(event) => onChange("content", event.target.value)}
          maxLength={50000}
          required
          disabled={disabled}
          className="min-h-48 flex-1"
        />
      </div>
    </>
  );
}
