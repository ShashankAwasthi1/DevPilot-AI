"use client";

import { useCallback, useState } from "react";
import type { ApiError } from "./api";
import {
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  getTask as getTaskRequest,
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
  // Synchronous, cache-only lookup - never triggers a request. Populated
  // from real create/update/getTask responses only, never fabricated.
  // Kept specifically so Part 8's due-date sort can read a task's real
  // due date (when known) without turning sorting into an N+1 request
  // storm - correctness of the details/edit UI must never depend on this
  // returning a hit; use fetchTask for that instead.
  getCachedTask: (taskId: string) => Task | undefined;
  // The server-backed source of truth for a single full Task. Returns the
  // cached entry immediately if one exists (no request), otherwise calls
  // GET /tasks/:id and caches the result. This is what task
  // details/editing should call - it always resolves to the real task (or
  // rejects with the real ApiError), regardless of whether this session
  // happened to already have it cached.
  fetchTask: (taskId: string) => Promise<Task>;
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

  const fetchTask = useCallback(
    async (taskId: string): Promise<Task> => {
      const cached = taskCache[taskId];
      if (cached) return cached;

      const task = await getTaskRequest(taskId);
      setTaskCache((prev) => ({ ...prev, [task.id]: task }));
      return task;
    },
    [taskCache],
  );

  return {
    tasks: data,
    loading,
    error,
    refresh,
    createTask,
    updateTask,
    deleteTask,
    getCachedTask,
    fetchTask,
  };
}
