"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FileText, MessageSquare, SearchX, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectActivity } from "@/components/projects/project-activity";
import { CreateTaskSheet } from "@/components/tasks/create-task-sheet";
import { TaskList } from "@/components/tasks/task-list";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import { useProjectMembers } from "@/lib/use-project-members";
import { useTasks } from "@/lib/use-tasks";
import type { ProjectSummary, SafeUser } from "@/lib/types";

// The project workspace home - new alongside the existing
// /projects/[id]/chat route, which is left entirely untouched and
// reachable via the "Open chat" link below. Auth/redirect handling
// mirrors chat/page.tsx exactly (same useApiData("/auth/me") + redirect
// pattern), since this page needs the identical guard.
export default function ProjectWorkspacePage() {
  // useParams() rather than use(props.params) - client-safe and never
  // suspends, unlike unwrapping a Promise-based params prop mid client-side
  // transition (the cause of the "Open chat" navigation hang between this
  // page and its sibling chat page).
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

  const { data: project, loading: projectLoading } = useApiData(
    () => api.get<{ project: ProjectSummary }>(`/projects/${projectId}`).then((res) => res.project),
    [projectId],
  );

  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    refresh,
    createTask,
    updateTask,
    deleteTask,
    getCachedTask,
    fetchTask,
  } = useTasks(projectId);

  // One project-level members fetch, shared by the create form and every
  // row's edit form - never refetched per-row/per-open.
  const {
    members,
    loading: membersLoading,
    error: membersError,
    refresh: refreshMembers,
  } = useProjectMembers(projectId);

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  // The backend returns an identical 404 whether the project genuinely
  // doesn't exist or the current user just isn't a member of it (never
  // leaking which, to avoid confirming a project's existence to a
  // non-member). Once the project fetch has settled with nothing to show,
  // stop here rather than falling through to task/member/activity UI that
  // has nothing valid to operate on.
  if (!projectLoading && !project) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-sm py-10">
          <Card>
            <CardHeader className="items-center text-center">
              <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-xl">Project not found</CardTitle>
              <CardDescription>
                This project doesn&apos;t exist, or you no longer have access to it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" className="w-full" asChild>
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {projectLoading && <Skeleton className="h-7 w-48" />}
          {!projectLoading && project && (
            <h1 className="truncate text-lg font-semibold text-foreground">{project.name}</h1>
          )}
          <p className="text-sm text-muted-foreground">Tasks</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="w-fit gap-1.5" asChild>
            <Link href={`/projects/${projectId}/docs`}>
              <FileText className="size-4" aria-hidden="true" />
              Docs
            </Link>
          </Button>
          <Button variant="outline" className="w-fit gap-1.5" asChild>
            <Link href={`/projects/${projectId}/members`}>
              <Users className="size-4" aria-hidden="true" />
              Members
            </Link>
          </Button>
          <Button variant="outline" className="w-fit gap-1.5" asChild>
            <Link href={`/projects/${projectId}/settings`}>
              <Settings className="size-4" aria-hidden="true" />
              Settings
            </Link>
          </Button>
          <Button variant="outline" className="w-fit gap-1.5" asChild>
            <Link href={`/projects/${projectId}/chat`}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Open chat
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tasks-heading" className="text-sm font-medium text-muted-foreground">
            Tasks
          </h2>
          <CreateTaskSheet
            onCreate={createTask}
            members={members ?? []}
            membersLoading={membersLoading}
            membersError={membersError}
            onRetryMembers={refreshMembers}
          />
        </div>

        <TaskList
          tasks={tasks}
          loading={tasksLoading}
          error={tasksError}
          onRetry={refresh}
          getCachedTask={getCachedTask}
          fetchTask={fetchTask}
          onUpdate={updateTask}
          onDelete={deleteTask}
          members={members ?? []}
          membersLoading={membersLoading}
          membersError={membersError}
          onRetryMembers={refreshMembers}
          // Fails closed to the most restrictive role while the project
          // itself is still loading (or failed to load), so the comments
          // composer is never shown before the caller's real role is
          // confirmed - the server remains the actual authority regardless.
          projectRole={project?.role ?? "VIEWER"}
        />
      </section>

      <ProjectActivity
        projectId={projectId}
        members={members ?? []}
        membersLoading={membersLoading}
        membersError={membersError}
        onRetryMembers={refreshMembers}
      />
    </main>
  );
}
