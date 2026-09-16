"use client";

import { useCallback, useState } from "react";
import type { ApiError } from "./api";
import {
  addProjectMember as addProjectMemberRequest,
  listProjectMembers,
  removeProjectMember as removeProjectMemberRequest,
  updateProjectMemberRole as updateProjectMemberRoleRequest,
  type AddProjectMemberInput,
  type UpdateProjectMemberRoleInput,
} from "./project-members";
import { useApiData } from "./use-api-data";
import type { ProjectMember } from "./types";

export interface UseProjectMembersResult {
  members: ProjectMember[] | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
  addProjectMember: (input: AddProjectMemberInput) => Promise<ProjectMember>;
  updateProjectMemberRole: (userId: string, input: UpdateProjectMemberRoleInput) => Promise<ProjectMember>;
  removeProjectMember: (userId: string) => Promise<ProjectMember>;
}

// One project-level fetch, reused by every task row's assignee picker -
// same refreshKey-bump-then-refetch shape as useTasks/useDocuments,
// layered on the existing useApiData hook. No global state: this hook is
// called once in app/projects/[id]/page.tsx and its result is passed down
// as props.
export function useProjectMembers(projectId: string): UseProjectMembersResult {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useApiData(
    () => listProjectMembers(projectId),
    [projectId, refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  // Same shape as useDocuments'/useTasks' mutation callbacks: call the API
  // function, let a thrown ApiError propagate to the caller (never
  // swallowed here), and only bump refreshKey - never merge/patch the
  // local `data` - on success, so the member list always reflects a real
  // server response rather than an optimistic guess. No separate
  // mutation-loading state is tracked here, matching the same convention:
  // every existing mutation hook in this codebase (useDocuments, useTasks)
  // leaves per-action submitting/error state to whichever UI component
  // calls the mutation (e.g. create-doc-sheet.tsx's own `submitting`
  // state), rather than a hook-level shared flag.
  const addProjectMember = useCallback(
    async (input: AddProjectMemberInput) => {
      const member = await addProjectMemberRequest(projectId, input);
      refresh();
      return member;
    },
    [projectId, refresh],
  );

  const updateProjectMemberRole = useCallback(
    async (userId: string, input: UpdateProjectMemberRoleInput) => {
      const member = await updateProjectMemberRoleRequest(projectId, userId, input);
      refresh();
      return member;
    },
    [projectId, refresh],
  );

  const removeProjectMember = useCallback(
    async (userId: string) => {
      const member = await removeProjectMemberRequest(projectId, userId);
      refresh();
      return member;
    },
    [projectId, refresh],
  );

  return {
    members: data,
    loading,
    error,
    refresh,
    addProjectMember,
    updateProjectMemberRole,
    removeProjectMember,
  };
}
