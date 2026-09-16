import type { PendingTaskAction } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AI_LIMITS } from "../ai/limits";
import type { CreateTaskInput } from "../validation/task.validation";

export interface CreatePendingTaskActionParams {
  conversationId: string;
  projectId: string;
  userId: string;
  proposedInput: CreateTaskInput;
}

// Persists an AI-proposed task creation for later, separately-authenticated
// confirmation (a future Phase 19 step - not implemented here). This
// function NEVER creates a Task itself; it only records the proposal.
// `proposedInput` must already be the tool schema's own fully-validated
// output (.strict().parse()) before it reaches here - this function does
// not re-validate task fields, it only persists them verbatim, since the
// confirm step (later) must execute exactly what was proposed, never a
// value edited in between.
//
// No authorization check lives here - role/assignee validation happens in
// the caller (create-task.tool.ts), reusing project.service.ts's/
// task.service.ts's existing functions, so this service has exactly one
// job: create the row.
export async function createPendingTaskAction(
  params: CreatePendingTaskActionParams,
): Promise<PendingTaskAction> {
  return prisma.pendingTaskAction.create({
    data: {
      conversationId: params.conversationId,
      projectId: params.projectId,
      userId: params.userId,
      proposedInput: params.proposedInput,
      expiresAt: new Date(Date.now() + AI_LIMITS.PENDING_TASK_ACTION_TTL_MS),
    },
  });
}
