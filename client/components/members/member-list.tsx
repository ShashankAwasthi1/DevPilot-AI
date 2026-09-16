"use client";

import { useState, type ChangeEvent, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SELECT_CLASSNAME } from "@/components/tasks/task-form-fields";
import { ApiError } from "@/lib/api";
import { canManageMemberRole, canRemoveMember } from "@/lib/permissions";
import type { UpdateProjectMemberRoleInput } from "@/lib/project-members";
import type { ProjectMember, ProjectRole } from "@/lib/types";

const ROLE_LABEL: Record<ProjectRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

// "OWNER" is never offered as a target role - the server rejects it (see
// server/src/validation/project.validation.ts's
// updateProjectMemberRoleSchema), since the owner is Project.ownerId,
// never a role a membership row can hold.
const ASSIGNABLE_ROLES: { value: "ADMIN" | "MEMBER" | "VIEWER"; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
];

interface MemberListProps {
  members: ProjectMember[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  // The viewer's own role in this project (ProjectSummary.role) - the only
  // input every permission check on this list needs. Never derived from
  // scanning `members` for "my" row, since the owner has no ProjectMember
  // row of their own.
  currentUserRole: ProjectRole;
  onUpdateRole: (userId: string, input: UpdateProjectMemberRoleInput) => Promise<ProjectMember>;
  onRemove: (userId: string) => Promise<ProjectMember>;
}

// Same loading/error/empty triad as doc-list.tsx/task-list.tsx.
export function MemberList({
  members,
  loading,
  error,
  onRetry,
  currentUserRole,
  onUpdateRole,
  onRemove,
}: MemberListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load members</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{error.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // In practice this never actually renders - the project owner is always
  // included by the server's listProjectMembers (see
  // project-member.service.ts), so every project has at least one row.
  // Kept for the same defensive reason every other list in this codebase
  // has an empty state, rather than assuming the invariant always holds.
  if (!members || members.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">No members yet.</CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          currentUserRole={currentUserRole}
          onUpdateRole={onUpdateRole}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

interface MemberRowProps {
  member: ProjectMember;
  currentUserRole: ProjectRole;
  onUpdateRole: (userId: string, input: UpdateProjectMemberRoleInput) => Promise<ProjectMember>;
  onRemove: (userId: string) => Promise<ProjectMember>;
}

// Mirrors DocRow's/TaskRow's inline confirm-swap pattern for the remove
// action, and TaskFormFields' native-select convention for the role
// change - no new UI primitives introduced.
function MemberRow({ member, currentUserRole, onUpdateRole, onRemove }: MemberRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const displayName = member.name || member.email;
  const isOwner = member.role === "OWNER";
  // The owner's role can never be changed or removed through this UI (or
  // the API it calls - see project-member.service.ts's own 409s), so
  // these controls are hidden for that row regardless of the viewer's own
  // role.
  const showRoleSelect = !isOwner && canManageMemberRole(currentUserRole);
  const showRemove = !isOwner && canRemoveMember(currentUserRole);

  function startConfirmingRemove(event: MouseEvent) {
    event.stopPropagation();
    setRemoveError(null);
    setConfirmingRemove(true);
  }

  function cancelRemove(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingRemove(false);
    setRemoveError(null);
  }

  async function confirmRemove(event: MouseEvent) {
    event.stopPropagation();
    if (removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onRemove(member.userId);
      // On success, the parent's refetch removes this row entirely once
      // it lands - nothing further to do here.
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Something went wrong.");
      setRemoving(false);
    }
  }

  async function handleRoleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextRole = event.target.value as "ADMIN" | "MEMBER" | "VIEWER";
    if (nextRole === member.role || updatingRole) return;
    setUpdatingRole(true);
    setRoleError(null);
    try {
      await onUpdateRole(member.userId, { role: nextRole });
      // The parent's refetch brings back the real new role - this select
      // is always controlled from `member.role`, never local state, so a
      // failed update simply leaves the select showing the unchanged
      // server value instead of an optimistic guess.
    } catch (err) {
      setRoleError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setUpdatingRole(false);
    }
  }

  if (confirmingRemove) {
    return (
      <li>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm font-medium">Remove member?</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{displayName}</span> will lose access to this
              project.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={confirmRemove} disabled={removing}>
                {removing ? "Removing…" : "Remove"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelRemove} disabled={removing}>
                Cancel
              </Button>
            </div>
            {removeError && <p className="text-xs text-destructive">{removeError}</p>}
          </CardContent>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{displayName}</span>
              <Badge variant={isOwner ? "default" : "outline"}>{ROLE_LABEL[member.role]}</Badge>
            </div>
            <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showRoleSelect && (
              <div className="flex flex-col gap-1">
                <label className="sr-only" htmlFor={`member-role-${member.userId}`}>
                  Change role for {displayName}
                </label>
                <select
                  id={`member-role-${member.userId}`}
                  className={`${SELECT_CLASSNAME} w-auto`}
                  value={member.role}
                  onChange={handleRoleChange}
                  disabled={updatingRole}
                >
                  {ASSIGNABLE_ROLES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {roleError && <p className="text-xs text-destructive">{roleError}</p>}
              </div>
            )}

            {showRemove && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={startConfirmingRemove}
                aria-label={`Remove ${displayName}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
