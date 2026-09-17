import { api, ApiError } from "./api";
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

// Phase 25 Step 5: the confirm endpoint now returns one of two shapes
// (server/src/controllers/pending-task-action.controller.ts, Phase 25
// Step 3) - { data: { task } } for a CREATE_TASK/UPDATE_TASK confirmation,
// { data: { tasks } } for a CREATE_PROJECT_PLAN confirmation. A
// discriminated union (rather than a bare `Task | Task[]`) so a caller
// must explicitly check `kind` before touching either field - it can never
// accidentally treat a single Task as an array or vice versa.
export type ConfirmPendingActionResult = { kind: "task"; task: Task } | { kind: "tasks"; tasks: Task[] };

// POST /projects/:projectId/conversations/:conversationId/actions/:actionId/confirm
// No request body - the server resolves everything it needs from the
// authenticated session and these three path segments (see
// server/src/controllers/pending-task-action.controller.ts). Exactly one
// request regardless of which proposal type this action is - a
// CREATE_PROJECT_PLAN confirmation is not turned into one request per
// proposed task.
export function confirmPendingTaskAction(
  projectId: string,
  conversationId: string,
  actionId: string,
): Promise<ConfirmPendingActionResult> {
  return api
    .post<{ task?: Task; tasks?: Task[] }>(
      `/projects/${projectId}/conversations/${conversationId}/actions/${actionId}/confirm`,
    )
    .then((result) => {
      if (Array.isArray(result.tasks)) return { kind: "tasks", tasks: result.tasks };
      if (result.task) return { kind: "task", task: result.task };
      // Defensive-only: the server always sends exactly one of the two
      // fields (see the controller's own Array.isArray discrimination) -
      // this can only mean an unexpected response shape, never a value a
      // caller should silently treat as success.
      throw new ApiError(500, "Something went wrong. Please try again.");
    });
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
