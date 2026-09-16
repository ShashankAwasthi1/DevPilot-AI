"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddMemberSheet } from "@/components/members/add-member-sheet";
import { MemberList } from "@/components/members/member-list";
import { api } from "@/lib/api";
import { canAddMember } from "@/lib/permissions";
import { useApiData } from "@/lib/use-api-data";
import { useProjectMembers } from "@/lib/use-project-members";
import type { ProjectSummary, SafeUser } from "@/lib/types";

// New alongside the existing /projects/[id] (tasks), /projects/[id]/chat,
// and /projects/[id]/docs routes, which are left entirely untouched. Auth
// handling mirrors all three exactly (same useApiData("/auth/me") +
// redirect pattern) since this page needs the identical guard.
export default function ProjectMembersPage() {
  // useParams() rather than use(props.params) - see the identical comment
  // in the sibling tasks/chat/docs pages for why (client-safe, never
  // suspends mid client-side transition).
  const projectId = useParams<{ id: string }>().id;
  const router = useRouter();

  const { data: user, loading: authLoading, error: authError } = useApiData(
    () => api.get<{ user: SafeUser }>("/auth/me").then((res) => res.user),
    [],
  );

  useEffect(() => {
    if (!authLoading && authError) {
      router.replace("/login");
    }
  }, [authLoading, authError, router]);

  // project.role is the current user's own role in this project, computed
  // server-side (project.service.ts's computeRole) - the single source of
  // truth every permission check on this page uses. It is never re-derived
  // by scanning the member list for "my" row, because the owner has no
  // ProjectMember row of their own (see project-member.service.ts).
  const { data: project, loading: projectLoading, error: projectError } = useApiData(
    () => api.get<{ project: ProjectSummary }>(`/projects/${projectId}`).then((res) => res.project),
    [projectId],
  );

  const {
    members,
    loading: membersLoading,
    error: membersError,
    refresh: refreshMembers,
    addProjectMember,
    updateProjectMemberRole,
    removeProjectMember,
  } = useProjectMembers(projectId);

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" asChild>
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to project
          </Link>
        </Button>
      </div>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 id="members-heading" className="text-lg font-semibold text-foreground">
            Members
          </h1>
          {/* Add Member is only ever rendered for a role that can actually
              use it - MEMBER/VIEWER never see this button, matching the
              server's own OWNER/ADMIN gate on POST /projects/:id/members. */}
          {!projectLoading && project && canAddMember(project.role) && (
            <AddMemberSheet onAdd={addProjectMember} />
          )}
        </div>

        {projectLoading && <Skeleton className="h-7 w-32" />}
        {!projectLoading && !project && projectError && (
          <p className="text-sm text-destructive">Couldn&apos;t load this project.</p>
        )}

        {!projectLoading && project && (
          <MemberList
            members={members}
            loading={membersLoading}
            error={membersError}
            onRetry={refreshMembers}
            currentUserRole={project.role}
            onUpdateRole={updateProjectMemberRole}
            onRemove={removeProjectMember}
          />
        )}
      </section>
    </main>
  );
}
