"use client";

import { useCallback, useState } from "react";
import type { ApiError } from "./api";
import {
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  listTasks,
  updateTask as updateTaskRequest,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./tasks";
import { useApiData } from "./use-api-data";
import type { Task, TaskSummary } from "./types";

export interface UseTasksResult {
  tasks: TaskSummary[] | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (taskId: string, input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (taskId: string) => Promise<void>;
  // The list endpoint only ever returns TaskSummary (see lib/types.ts), so
  // this is the only source of full Task data (description/assigneeId/
  // dueDate/createdById/timestamps) the frontend has - populated purely
  // from real create/update responses, never fabricated or derived from a
  // summary. A task never created/edited in this session simply has no
  // entry here; callers (task details/edit UI) must treat that as "full
  // detail unavailable", not guess.
  getCachedTask: (taskId: string) => Task | undefined;
}

// Same refreshKey-bump-then-refetch idiom as
// client/app/projects/[id]/chat/page.tsx's conversation handlers - no
// optimistic mutation, no new state-management dependency, layered
// entirely on top of the existing useApiData hook. create/update/delete
// each await the server response first, then bump refreshKey so the list
// re-fetches from the server rather than having the caller guess at the
// resulting shape locally.
export function useTasks(projectId: string, limit?: number): UseTasksResult {
  const [refreshKey, setRefreshKey] = useState(0);
  const [taskCache, setTaskCache] = useState<Record<string, Task>>({});

  const { data, loading, error } = useApiData(
    () => listTasks(projectId, limit),
    [projectId, limit, refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const task = await createTaskRequest(projectId, input);
      setTaskCache((prev) => ({ ...prev, [task.id]: task }));
      refresh();
      return task;
    },
    [projectId, refresh],
  );

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTaskInput) => {
      const task = await updateTaskRequest(taskId, input);
      setTaskCache((prev) => ({ ...prev, [task.id]: task }));
      refresh();
      return task;
    },
    [refresh],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      await deleteTaskRequest(taskId);
      setTaskCache((prev) => {
        if (!(taskId in prev)) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      refresh();
    },
    [refresh],
  );

  const getCachedTask = useCallback((taskId: string) => taskCache[taskId], [taskCache]);

  return { tasks: data, loading, error, refresh, createTask, updateTask, deleteTask, getCachedTask };
}
