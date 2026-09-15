"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateTaskSheet } from "@/components/tasks/create-task-sheet";
import { TaskList } from "@/components/tasks/task-list";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import { useTasks } from "@/lib/use-tasks";
import type { ProjectSummary, SafeUser } from "@/lib/types";

// The project workspace home - new alongside the existing
// /projects/[id]/chat route, which is left entirely untouched and
// reachable via the "Open chat" link below. Auth/redirect handling
// mirrors chat/page.tsx exactly (same useApiData("/auth/me") + redirect
// pattern), since this page needs the identical guard.
export default function ProjectWorkspacePage(props: PageProps<"/projects/[id]">) {
  const { id: projectId } = use(props.params);
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

  const { data: project, loading: projectLoading, error: projectError } = useApiData(
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
  } = useTasks(projectId);

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
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
          {!projectLoading && !project && projectError && (
            <h1 className="text-lg font-semibold text-foreground">Project</h1>
          )}
          <p className="text-sm text-muted-foreground">Tasks</p>
        </div>
        <Button variant="outline" className="w-fit gap-1.5" asChild>
          <Link href={`/projects/${projectId}/chat`}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Open chat
          </Link>
        </Button>
      </header>

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tasks-heading" className="text-sm font-medium text-muted-foreground">
            Tasks
          </h2>
          <CreateTaskSheet onCreate={createTask} />
        </div>

        <TaskList
          tasks={tasks}
          loading={tasksLoading}
          error={tasksError}
          onRetry={refresh}
          getCachedTask={getCachedTask}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      </section>
    </main>
  );
}
