"use client";

import { useCallback, useState } from "react";
import type { ApiError } from "./api";
import { listProjectMembers } from "./project-members";
import { useApiData } from "./use-api-data";
import type { ProjectMember } from "./types";

export interface UseProjectMembersResult {
  members: ProjectMember[] | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
}

// One project-level fetch, reused by every task row's assignee picker -
// same refreshKey-bump-then-refetch shape as useTasks, layered on the
// existing useApiData hook. No global state: this hook is called once in
// app/projects/[id]/page.tsx and its result is passed down as props.
export function useProjectMembers(projectId: string): UseProjectMembersResult {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useApiData(
    () => listProjectMembers(projectId),
    [projectId, refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  return { members: data, loading, error, refresh };
}
