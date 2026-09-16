"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FolderKanban, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectCard } from "./project-card";

interface ProjectsSectionProps {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onCreated: (project: ProjectSummary) => void;
}

// Presentational - fetching/refresh lives in app/dashboard/page.tsx's
// useProjects() (same list the page-level "Create Project" button in
// DashboardHeader also refreshes), same split as TaskList vs.
// app/projects/[id]/page.tsx's useTasks().
export function ProjectsSection({ projects, loading, error, onRetry, onCreated }: ProjectsSectionProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section aria-labelledby="projects-heading" className="flex flex-col gap-3">
      <h2 id="projects-heading" className="text-sm font-medium text-muted-foreground">
        Your projects
      </h2>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your projects</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && projects && projects.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FolderKanban className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium text-foreground">No projects yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create your first project to start managing tasks, docs, and your AI teammate.
            </p>
            <CreateProjectDialog
              onCreated={onCreated}
              trigger={
                <Button type="button" className="mt-2 gap-1.5">
                  <Plus className="size-4" aria-hidden="true" />
                  Create Project
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!loading && !error && projects && projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: prefersReducedMotion ? 0 : index * 0.04 }}
              whileHover={prefersReducedMotion ? undefined : { y: -2 }}
            >
              <ProjectCard project={project} />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
