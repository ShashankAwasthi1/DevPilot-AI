"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { FolderKanban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { useApiData } from "@/lib/use-api-data";
import type { ProjectSummary } from "@/lib/types";

const ROLE_LABEL: Record<ProjectSummary["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export function ProjectsSection() {
  const prefersReducedMotion = useReducedMotion();
  const { data, loading, error } = useApiData(
    () => api.get<{ projects: ProjectSummary[] }>("/projects"),
    [],
  );

  return (
    <section aria-labelledby="projects-heading" className="flex flex-col gap-3">
      <h2 id="projects-heading" className="text-sm font-medium text-muted-foreground">
        Your projects
      </h2>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your projects</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && data && data.projects.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <FolderKanban className="size-8" aria-hidden="true" />
            <p>You don&apos;t have any projects yet.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: prefersReducedMotion ? 0 : index * 0.04 }}
              whileHover={prefersReducedMotion ? undefined : { y: -2 }}
            >
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-base">{project.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{ROLE_LABEL[project.role]}</span>
                    <span>Updated {formatRelativeTime(project.updatedAt)}</span>
                  </div>
                  <Button variant="outline" size="sm" className="w-fit gap-1.5" asChild>
                    <Link href={`/projects/${project.id}`}>
                      <FolderKanban className="size-3.5" aria-hidden="true" />
                      Open
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
