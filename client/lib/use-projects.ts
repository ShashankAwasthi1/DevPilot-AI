"use client";

import { useCallback, useState } from "react";
import { api } from "./api";
import type { ApiError } from "./api";
import { useApiData } from "./use-api-data";
import type { ProjectSummary } from "./types";

export interface UseProjectsResult {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
}

// GET /projects - the exact existing endpoint ProjectsSection already
// called directly; pulled into its own hook (same refreshKey-bump-then-
// refetch shape as use-tasks.ts/use-project-members.ts) so the dashboard
// page can also trigger a refresh after Create Project succeeds, without
// ProjectsSection owning state the page-level header needs too.
export function useProjects(): UseProjectsResult {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useApiData(
    () => api.get<{ projects: ProjectSummary[] }>("/projects").then((res) => res.projects),
    [refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  return { projects: data, loading, error, refresh };
}
