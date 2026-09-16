"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import type { UpdateProjectInput } from "@/lib/projects";
import type { ProjectSummary } from "@/lib/types";

interface GeneralSettingsCardProps {
  project: ProjectSummary;
  // Whether the current user is allowed to edit (canUpdateProject(project.role),
  // computed by the caller - this component does no permission checking of
  // its own). Fields are disabled and the Save button is never enabled when
  // this is false; the server remains the actual authorization boundary
  // regardless of what this flag says.
  canEdit: boolean;
  onSave: (input: UpdateProjectInput) => Promise<ProjectSummary>;
}

// Same name/description bounds as CreateProjectDialog (mirrors
// server/src/validation/project.validation.ts's createProjectSchema/
// updateProjectSchema exactly) - no new validation rule invented here.
export function GeneralSettingsCard({ project, canEdit, onSave }: GeneralSettingsCardProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const isDirty = trimmedName !== project.name || trimmedDescription !== (project.description ?? "");
  const canSave = canEdit && isDirty && !submitting && trimmedName.length > 0;

  function handleNameChange(value: string) {
    setName(value);
    setSaved(false);
  }

  function handleDescriptionChange(value: string) {
    setDescription(value);
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const updated = await onSave({ name: trimmedName, description: trimmedDescription });
      // Server response is authoritative - re-sync the form to exactly
      // what was saved, rather than assuming the locally trimmed values
      // matched it byte-for-byte.
      setName(updated.name);
      setDescription(updated.description ?? "");
      setSaved(true);
    } catch (err) {
      // Entered values are left exactly as the user typed them on
      // failure - only submitting/error state changes here.
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-project-name">Project name</Label>
            <Input
              id="settings-project-name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              maxLength={200}
              required
              disabled={!canEdit || submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-project-description">Description</Label>
            <Textarea
              id="settings-project-description"
              value={description}
              onChange={(event) => handleDescriptionChange(event.target.value)}
              maxLength={2000}
              disabled={!canEdit || submitting}
              placeholder="Optional"
            />
          </div>

          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              You don&apos;t have permission to edit this project&apos;s settings.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-muted-foreground">Saved.</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSave}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
