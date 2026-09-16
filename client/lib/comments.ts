import { api } from "./api";
import type { TaskComment } from "./types";

// GET/POST /tasks/:taskId/comments - not
// /projects/:projectId/tasks/:taskId/comments (comment.routes.ts is
// mounted at "/tasks", same as task.service.ts's own GET/PATCH/DELETE
// /tasks/:id - the task's own id already scopes everything server-side,
// same convention lib/tasks.ts's getTask/updateTask/deleteTask already
// follow, so no projectId is ever needed here either).
export function listTaskComments(taskId: string): Promise<TaskComment[]> {
  return api.get<{ comments: TaskComment[] }>(`/tasks/${taskId}/comments`).then((result) => result.comments);
}

export function createTaskComment(taskId: string, body: string): Promise<TaskComment> {
  return api
    .post<{ comment: TaskComment }>(`/tasks/${taskId}/comments`, { body })
    .then((result) => result.comment);
}
