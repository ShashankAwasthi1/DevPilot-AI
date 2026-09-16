"use client";

import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";

const ROLE_LABEL: Record<ProjectSummary["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

interface ProjectCardProps {
  project: ProjectSummary;
}

// The entire card is one real link (not a decorative div with a button
// tucked inside) - keyboard/focus/click all land on the same accessible
// element, and it navigates straight into the existing project workspace
// (tasks, chat, etc. all already live at that route) rather than
// duplicating any of that here.
export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Card className="h-full transition-colors hover:bg-muted/50">
      <Link
        href={`/projects/${project.id}`}
        className="flex h-full flex-col rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{project.name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {project.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">No description</p>
          )}
          <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
            <span>{ROLE_LABEL[project.role]}</span>
            <span>Updated {formatRelativeTime(project.updatedAt)}</span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
