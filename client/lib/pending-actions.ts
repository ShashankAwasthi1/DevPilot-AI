import { api } from "./api";
import type { Task } from "./types";

// Path construction matches every other lib/*.ts module exactly (tasks.ts,
// documents.ts, project-members.ts) - plain template-literal
// interpolation, no encodeURIComponent. These ids are never raw
// user-typed text: projectId/conversationId always come from the route
// the caller is already on, and actionId always comes from a
// server-issued "pending_action" SSE event (see lib/ai-chat.ts) - all
// three are opaque, server-generated identifiers, the same trust level as
// every other id already interpolated this way throughout this codebase.

export interface CancelPendingTaskActionResult {
  actionId: string;
  status: "CANCELLED";
}

// POST /projects/:projectId/conversations/:conversationId/actions/:actionId/confirm
// No request body - the server resolves everything it needs from the
// authenticated session and these three path segments (see
// server/src/controllers/pending-task-action.controller.ts). Returns the
// newly-created Task, matching the server's { task: TaskDto } response
// exactly - no new type needed since Task already mirrors TaskDto.
export function confirmPendingTaskAction(
  projectId: string,
  conversationId: string,
  actionId: string,
): Promise<Task> {
  return api
    .post<{ task: Task }>(`/projects/${projectId}/conversations/${conversationId}/actions/${actionId}/confirm`)
    .then((result) => result.task);
}

// POST /projects/:projectId/conversations/:conversationId/actions/:actionId/cancel
// No request body, same shape as confirm above. Returns the cancelled
// action's id/status, matching the server's { action: {actionId, status} }
// response.
export function cancelPendingTaskAction(
  projectId: string,
  conversationId: string,
  actionId: string,
): Promise<CancelPendingTaskActionResult> {
  return api
    .post<{ action: CancelPendingTaskActionResult }>(
      `/projects/${projectId}/conversations/${conversationId}/actions/${actionId}/cancel`,
    )
    .then((result) => result.action);
}
