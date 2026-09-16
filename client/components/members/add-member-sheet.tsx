"use client";

import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SELECT_CLASSNAME } from "@/components/tasks/task-form-fields";
import { ApiError } from "@/lib/api";
import type { AddProjectMemberInput } from "@/lib/project-members";
import type { ProjectMember } from "@/lib/types";

// "OWNER" is never offered here - the server rejects it anyway (see
// server/src/validation/project.validation.ts's addProjectMemberSchema),
// since the owner is Project.ownerId, never a role a membership row can
// hold.
const ROLE_OPTIONS: { value: "ADMIN" | "MEMBER" | "VIEWER"; label: string }[] = [
  { value: "MEMBER", label: "Member" },
  { value: "ADMIN", label: "Admin" },
  { value: "VIEWER", label: "Viewer" },
];

interface AddMemberSheetProps {
  onAdd: (input: AddProjectMemberInput) => Promise<ProjectMember>;
}

// Same Sheet-as-dialog pattern as create-doc-sheet.tsx/create-task-sheet.tsx -
// reused rather than introducing a new dialog primitive. The caller only
// ever renders this when canAddMember(currentUserRole) is true (see
// app/projects/[id]/members/page.tsx) - this component itself does no
// permission checking of its own.
export function AddMemberSheet({ onAdd }: AddMemberSheetProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmail("");
      setRole("MEMBER");
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ email: trimmedEmail, role });
      setEmail("");
      setRole("MEMBER");
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
          <UserPlus className="size-4" aria-hidden="true" />
          Add member
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add member</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-member-email">Email</Label>
            <Input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-member-role">Role</Label>
            <select
              id="add-member-role"
              className={SELECT_CLASSNAME}
              value={role}
              onChange={(event) => setRole(event.target.value as "ADMIN" | "MEMBER" | "VIEWER")}
              disabled={submitting}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add member"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
