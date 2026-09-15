import { api } from "./api";
import type { Task, TaskPriority, TaskStatus, TaskSummary } from "./types";

// Request-side shapes, kept here rather than in types.ts - unlike the
// interfaces there, these aren't mirrors of a server response DTO, they're
// what a caller may send. Mirrors the field set (and optionality) of
// server/src/validation/task.validation.ts's createTaskSchema/
// updateTaskSchema; projectId/createdById are deliberately absent from
// both, since the server never accepts them from the request body either.
export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

// GET /projects/:projectId/tasks - returns TaskSummary[], not Task[]; see
// the TaskSummary comment in lib/types.ts for why the shapes differ.
export function listTasks(projectId: string, limit?: number): Promise<TaskSummary[]> {
  const query = limit !== undefined ? `?${new URLSearchParams({ limit: String(limit) })}` : "";
  return api
    .get<{ tasks: TaskSummary[] }>(`/projects/${projectId}/tasks${query}`)
    .then((result) => result.tasks);
}

// GET /tasks/:id - the full TaskDto, authorized the same way update/delete
// are (project membership via the task's own projectId); a task outside
// the caller's projects 404s exactly like update/delete already do.
export function getTask(taskId: string): Promise<Task> {
  return api.get<{ task: Task }>(`/tasks/${taskId}`).then((result) => result.task);
}

export function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  return api.post<{ task: Task }>(`/projects/${projectId}/tasks`, input).then((result) => result.task);
}

export function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  return api.patch<{ task: Task }>(`/tasks/${taskId}`, input).then((result) => result.task);
}

export function deleteTask(taskId: string): Promise<void> {
  return api.delete<Record<string, never>>(`/tasks/${taskId}`).then(() => undefined);
}
