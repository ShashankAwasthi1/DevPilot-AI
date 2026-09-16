"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";
import { GeneralSettingsCard } from "@/components/settings/general-settings-card";
import { api } from "@/lib/api";
import { canArchiveProject, canUpdateProject } from "@/lib/permissions";
import { archiveProject, updateProject, type UpdateProjectInput } from "@/lib/projects";
import { useApiData } from "@/lib/use-api-data";
import type { ProjectSummary, SafeUser } from "@/lib/types";

// New alongside the existing /projects/[id] (tasks), /projects/[id]/chat,
// /projects/[id]/docs, and /projects/[id]/members routes, which are left
// entirely untouched. Auth handling mirrors all of them exactly (same
// useApiData("/auth/me") + redirect pattern) since this page needs the
// identical guard.
export default function ProjectSettingsPage() {
  // useParams() rather than use(props.params) - see the identical comment
  // in the sibling tasks/chat/docs/members pages for why (client-safe,
  // never suspends mid client-side transition).
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

  const { data: fetchedProject, loading: projectLoading, error: projectError } = useApiData(
    () => api.get<{ project: ProjectSummary }>(`/projects/${projectId}`).then((res) => res.project),
    [projectId],
  );

  // A mutation's own server response overrides the initial GET's result -
  // never an optimistic guess, never a refetch, just whatever the server
  // most recently confirmed. Starts null (no override yet), so the
  // displayed project is the freshly-fetched one until a save actually
  // succeeds.
  const [savedProject, setSavedProject] = useState<ProjectSummary | null>(null);
  const project = savedProject ?? fetchedProject;

  async function handleSave(input: UpdateProjectInput): Promise<ProjectSummary> {
    const updated = await updateProject(projectId, input);
    setSavedProject(updated);
    return updated;
  }

  async function handleArchive(): Promise<void> {
    await archiveProject(projectId);
    router.push("/dashboard");
  }

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" asChild>
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to project
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Project settings</h1>
        <p className="text-sm text-muted-foreground">Project configuration</p>
      </div>

      {projectLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!projectLoading && !project && (
        <p className="text-sm text-destructive">
          {projectError?.message ?? "Couldn't load this project."}
        </p>
      )}

      {!projectLoading && project && (
        <>
          <GeneralSettingsCard project={project} canEdit={canUpdateProject(project.role)} onSave={handleSave} />

          {canArchiveProject(project.role) && (
            <DangerZoneCard projectName={project.name} onArchive={handleArchive} />
          )}
        </>
      )}
    </main>
  );
}
