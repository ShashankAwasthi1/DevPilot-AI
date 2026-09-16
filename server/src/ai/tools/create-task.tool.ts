import { z } from "zod";
import { assertRole, getProjectAccess } from "../../services/project.service";
import { assertAssigneeIsProjectMember } from "../../services/task.service";
import { listProjectMembers } from "../../services/project-member.service";
import { createPendingTaskAction } from "../../services/pending-task-action.service";
import type { CreateTaskInput } from "../../validation/task.validation";
import type { ToolDefinition } from "./types";

// Mirrors createTaskSchema's exact field semantics (server/src/validation/
// task.validation.ts) - not a different set of task-creation rules. Unlike
// that HTTP-layer schema (a plain z.object(), which silently strips unknown
// keys), this is .strict() per this codebase's existing AI-tool convention
// (every tool in ./index.ts uses .strict()) - a model sending an unexpected
// field is more likely confused than malicious, and should fail loudly
// rather than have the extra field silently discarded.
//
// projectId/userId/createdById are deliberately NOT fields here - they can
// never be supplied by the model. They come exclusively from ToolContext,
// exactly like every other tool in this registry.
const schema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).nullable().optional(),
    status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]).default("TODO"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    assigneeId: z.string().trim().min(1).nullable().optional(),
    dueDate: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

// The UI-only side payload (never sent to the model - see tool-loop.ts's
// executeToolCall, which recognizes this tool's { result, pendingAction }
// return shape by name and keeps `pendingAction` out of the provider-facing
// tool_result content, the same way searchDocuments' `sources` is kept
// out). Field list matches the Phase 19 Step 3 design exactly.
export interface PendingTaskActionRef {
  actionId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  expiresAt: string;
}

// This tool NEVER calls prisma.task.create (and never will - see
// pending-task-action.service.ts's own doc comment). It only proposes: it
// validates the request exactly as the real createTask API would, then
// stages a PendingTaskAction row for a separately-authenticated
// confirmation step (a later Phase 19 step, not implemented here) to act
// on. The model-facing result never claims a task was created.
export const createTaskTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "createTask",
  description:
    "Propose creating a new task in the current project. This does NOT create the task immediately - it stages a proposal that the user must explicitly review and confirm in the app UI before anything is written. Use this when the user asks you to create/add a task. After calling this, tell the user a proposal is ready for their review; never say the task has been created.",
  schema,
  handler: async (args, ctx) => {
    // Same authorization rule as the real, human-facing createTask API
    // (task.service.ts) - OWNER/ADMIN/MEMBER may create, VIEWER may not.
    // Reused via the same assertRole/getProjectAccess functions, not a
    // second, parallel permission check.
    const { role } = await getProjectAccess(ctx.projectId, ctx.userId);
    assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

    let assigneeName: string | null = null;
    if (args.assigneeId) {
      // Same assignee-membership rule as the real createTask API, reused
      // (not duplicated) from task.service.ts.
      await assertAssigneeIsProjectMember(ctx.projectId, args.assigneeId);

      // Resolved only for the UI-facing pendingAction payload below (so the
      // confirmation card can show a name, not a bare id) - reuses the
      // existing, already-authorized member-listing service rather than a
      // new raw Prisma lookup in the AI tool layer.
      const members = await listProjectMembers(ctx.userId, ctx.projectId);
      const assignee = members.find((member) => member.userId === args.assigneeId);
      assigneeName = assignee?.name ?? assignee?.email ?? null;
    }

    const proposedInput: CreateTaskInput = {
      title: args.title,
      description: args.description,
      status: args.status,
      priority: args.priority,
      assigneeId: args.assigneeId,
      dueDate: args.dueDate,
    };

    // conversationId is always present on a real request (message.controller.ts
    // sets it unconditionally) - the ToolContext field is optional only so
    // read-only tools' existing tests never had to be touched (see
    // ToolContext's own doc comment). Guarded defensively rather than
    // asserted with `!`, since a thrown error here still collapses safely
    // to { ok: false } via tool-loop.ts's executeToolCall.
    if (!ctx.conversationId) {
      throw new Error("createTask requires a conversation-scoped context");
    }

    const pendingAction = await createPendingTaskAction({
      conversationId: ctx.conversationId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      proposedInput,
    });

    const pendingActionRef: PendingTaskActionRef = {
      actionId: pendingAction.id,
      title: proposedInput.title,
      description: proposedInput.description ?? null,
      status: proposedInput.status ?? "TODO",
      priority: proposedInput.priority ?? "MEDIUM",
      assigneeId: proposedInput.assigneeId ?? null,
      assigneeName,
      dueDate: proposedInput.dueDate ?? null,
      expiresAt: pendingAction.expiresAt.toISOString(),
    };

    // Model-facing result is deliberately minimal: no task id (none
    // exists), no database internals, no user ids, no raw Prisma object -
    // just enough for the model to refer to the proposal in its own next
    // sentence. The richer pendingActionRef above is UI-only.
    return {
      result: {
        status: "pending_confirmation",
        actionId: pendingAction.id,
        summary: `Proposed task "${proposedInput.title}" — awaiting your confirmation.`,
      },
      pendingAction: pendingActionRef,
    };
  },
};
