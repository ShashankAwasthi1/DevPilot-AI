import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertRole, getProjectAccess } from "../../services/project.service";
import { createPendingTaskAction } from "../../services/pending-task-action.service";
import { AI_LIMITS } from "../limits";
import type { ToolDefinition } from "./types";

// The plan IS the tool's input - the model doesn't call this tool with
// "instructions" for a second AI call to draft a plan elsewhere; it calls
// this tool with the plan already filled in, exactly like createTask's
// arguments already are the proposed task. This reuses the provider's own
// tool-calling/JSON-schema enforcement with no new AI-provider mechanics
// and no secondary model call.
//
// No status/assigneeId/dueDate per task (Phase 25 Step 1 design,
// explicitly deferred): every generated task is created TODO and
// unassigned, matching the smallest-safe-surface MVP - a model-chosen
// status/assignee/deadline is more likely to mislead than help, and can be
// added later if requested. No dependsOn either - see the Step 1 design's
// explicit recommendation to keep dependencies out of the first
// implementation (no existing Task-dependency schema to validate against).
const schema = z
  .object({
    planTitle: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).nullable().optional(),
    tasks: z
      .array(
        z
          .object({
            // A plan-scoped, model-chosen identifier - never a real
            // database id, never looked up against anything. Exists so
            // each proposed task has a stable identity for rendering
            // (React keys, debug output) and as a forward-compatible hook
            // if dependency support is added in a later phase.
            tempId: z.string().trim().min(1).max(20),
            title: z.string().trim().min(1).max(200),
            description: z.string().trim().max(10000).nullable().optional(),
            priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
          })
          .strict(),
      )
      .min(1)
      .max(AI_LIMITS.MAX_PLAN_TASKS),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Duplicate tempIds would make the identifiers meaningless (and would
    // break any future dependency reference); duplicate *titles* are
    // deliberately allowed below - Task.title has no uniqueness
    // constraint in the schema today, so a plan proposing two
    // similarly-named tasks is not a validation error.
    const ids = new Set<string>();

    for (const task of value.tasks) {
      if (ids.has(task.tempId)) {
        ctx.addIssue({
          code: "custom",
          path: ["tasks"],
          message: "Task tempId values must be unique.",
        });
        break;
      }

      ids.add(task.tempId);
    }
  });

// The UI-only side payload (never sent to the model - see tool-loop.ts's
// executeToolCall, which recognizes this tool's { result, pendingAction }
// return shape by name and keeps `pendingAction` out of the provider-facing
// tool_result content, the same way createTask's PendingTaskActionRef/
// updateTask's UpdateTaskPendingActionRef are). Mirrors the persisted
// proposal shape exactly (planTitle/summary/tasks) plus the action's own
// id/expiresAt - never projectId/userId/conversationId/authority of any
// kind, same posture as the other two tools' refs.
export interface ProjectPlanTaskRef {
  tempId: string;
  title: string;
  description: string | null;
  priority: string;
}

export interface ProjectPlanPendingActionRef {
  // Phase 25 Step 4: discriminates this ref from create-task.tool.ts's
  // PendingTaskActionRef and update-task.tool.ts's
  // UpdateTaskPendingActionRef inside tool-loop.ts's shared
  // PendingActionRef union - always this literal value for a plan
  // proposal, never read from anywhere else.
  actionType: "CREATE_PROJECT_PLAN";
  actionId: string;
  planTitle: string;
  summary: string | null;
  tasks: ProjectPlanTaskRef[];
  expiresAt: string;
}

// This tool NEVER calls taskService.createTask (and never will at propose
// time - see pending-task-action.service.ts's own doc comment). It only
// proposes: it validates the request, then stages a PendingTaskAction row
// (actionType: "CREATE_PROJECT_PLAN") for a separately-authenticated
// confirmation step (Phase 25 Step 3) to act on. The model-facing result
// never claims any task was created.
export const generateProjectPlanTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "generateProjectPlan",
  description:
    "Propose a structured project plan (a title, an optional summary, and a list of tasks) based on the user's request and whatever project context you've already gathered. This does NOT create any tasks immediately - it stages a proposal that the user must explicitly review and confirm in the app UI before anything is written. If the user's request would benefit from knowing the project's existing tasks or documentation, use getTasks/getDocuments/searchDocuments first. After calling this, tell the user a plan proposal is ready for their review; never say the tasks have been created.",
  schema,
  handler: async (args, ctx) => {
    // Same authorization boundary createTask/updateTask already use -
    // OWNER/ADMIN/MEMBER may propose, VIEWER may not. Reused via the same
    // getProjectAccess/assertRole functions, not a second, parallel
    // permission check. Never mutates the project or creates anything.
    const { role } = await getProjectAccess(ctx.projectId, ctx.userId);
    assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

    if (!ctx.conversationId) {
      throw new Error("generateProjectPlan requires a conversation-scoped context");
    }

    // Persisted verbatim: only planTitle/summary/tasks, exactly as
    // validated above - never projectId/userId/conversationId (those live
    // on the row's own dedicated columns, supplied separately below,
    // never read back out of this JSON blob at confirm time), never a
    // generated database id (none exist yet), never dependency data (not
    // part of this schema at all).
    const proposedInput = {
      planTitle: args.planTitle,
      summary: args.summary ?? null,
      tasks: args.tasks,
    };

    const pendingAction = await createPendingTaskAction({
      conversationId: ctx.conversationId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      actionType: "CREATE_PROJECT_PLAN",
      // No existing task to point at - a plan creates new tasks, it never
      // targets one that already exists (that's updateTask's job).
      taskId: undefined,
      proposedInput: proposedInput as unknown as Prisma.InputJsonValue,
    });

    const pendingActionRef: ProjectPlanPendingActionRef = {
      actionType: "CREATE_PROJECT_PLAN",
      actionId: pendingAction.id,
      planTitle: proposedInput.planTitle,
      summary: proposedInput.summary,
      tasks: proposedInput.tasks.map((task) => ({
        tempId: task.tempId,
        title: task.title,
        description: task.description ?? null,
        priority: task.priority,
      })),
      expiresAt: pendingAction.expiresAt.toISOString(),
    };

    // Model-facing result is deliberately minimal: no task list, no
    // internal ids beyond the action id itself, no database internals -
    // just enough for the model to refer to the proposal in its own next
    // sentence. The richer pendingActionRef above is UI-only, kept out of
    // this object exactly like createTask's/updateTask's own refs are
    // (see tool-loop.ts's executeToolCall, which now recognizes this tool
    // by name too - Phase 25 Step 4).
    return {
      result: {
        status: "pending_confirmation",
        actionId: pendingAction.id,
        summary: `Proposed a plan with ${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"} — awaiting your confirmation.`,
      },
      pendingAction: pendingActionRef,
    };
  },
};
