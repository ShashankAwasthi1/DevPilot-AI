"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ActivitySection } from "@/components/dashboard/activity-section";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { NotificationsSection } from "@/components/dashboard/notifications-section";
import { ProjectsSection } from "@/components/dashboard/projects-section";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import { useProjects } from "@/lib/use-projects";
import type { SafeUser } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const { data: user, loading, error } = useApiData(
    () => api.get<{ user: SafeUser }>("/auth/me").then((res) => res.user),
    [],
  );

  // Owned here (rather than inside ProjectsSection) so DashboardHeader's
  // "Create Project" button and ProjectsSection's own empty-state button
  // both refresh the exact same list - a single source of truth, same
  // pattern as app/projects/[id]/page.tsx's useTasks().
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    refresh: refreshProjects,
  } = useProjects();

  useEffect(() => {
    // No session (or the API is unreachable) - there's nothing a dashboard
    // can show, so send the visitor to sign in rather than render an
    // unauthenticated shell.
    if (!loading && error) {
      router.replace("/login");
    }
  }, [loading, error, router]);

  if (loading || error || !user) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return (
    <motion.main
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6"
    >
      <DashboardHeader user={user} onProjectCreated={refreshProjects} />
      <Separator />
      <ProjectsSection
        projects={projects}
        loading={projectsLoading}
        error={projectsError}
        onRetry={refreshProjects}
        onCreated={refreshProjects}
      />
      <NotificationsSection />
      <ActivitySection />
    </motion.main>
  );
}
