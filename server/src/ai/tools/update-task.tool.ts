import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertRole } from "../../services/project.service";
import { assertAssigneeIsProjectMember, getTaskAccess } from "../../services/task.service";
import { createPendingTaskAction } from "../../services/pending-task-action.service";
import { AppError } from "../../utils/AppError";
import type { ToolDefinition } from "./types";

// Mirrors updateTaskSchema's exact field semantics (server/src/validation/
// task.validation.ts) - every field optional, no defaults (unlike
// createTaskSchema's status/priority defaults, which would be actively
// wrong here: a default would turn "the model didn't mention this field"
// into "the model wants to reset it"). .strict() per this codebase's
// existing AI-tool convention (see create-task.tool.ts) - an unexpected
// field is more likely confused than malicious, and should fail loudly.
//
// taskId is required and is never part of `changes` below - it identifies
// which task the proposal targets, not a field being changed.
const schema = z
  .object({
    taskId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    assigneeId: z.string().trim().min(1).nullable().optional(),
    dueDate: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.priority !== undefined ||
      value.assigneeId !== undefined ||
      value.dueDate !== undefined,
    { message: "At least one field must be provided to update." },
  );

// Only the fields the model actually supplied - built via an explicit
// allow-list copy in the handler below, never a spread of the parsed args
// (which would also carry taskId). undefined here means "omitted, leave
// unchanged"; an explicit null on description/assigneeId/dueDate means
// "clear this field" - the same distinction updateTaskSchema/
// taskService.updateTask already rely on.
export interface UpdateTaskProposedChanges {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}

// Captured from the task getTaskAccess already fetched, BEFORE the
// proposed changes are applied. Doubles as the staleness anchor a later
// confirm step (Phase 24 Step 3) will compare against the task's
// then-current updatedAt - not used for that purpose here.
export interface UpdateTaskProposedSnapshot {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  dueDate: string | null;
  updatedAt: string;
}

export interface UpdateTaskProposedInput {
  changes: UpdateTaskProposedChanges;
  snapshot: UpdateTaskProposedSnapshot;
}

// The UI-facing shape of one changing field - "from" always comes from the
// snapshot (the task's real value before this proposal), "to" always
// comes from `changes` (what the model actually proposed), both as plain
// strings or null. Never a model-authored label: assigneeId stays a raw
// id here (name resolution, if any, is the frontend's job - Phase 24
// Step 5 - not built here to avoid a member-list fetch this step doesn't
// otherwise need).
export type UpdateTaskChangeField = "title" | "description" | "status" | "priority" | "assigneeId" | "dueDate";

export interface FieldChange {
  field: UpdateTaskChangeField;
  from: string | null;
  to: string | null;
}

// The UI-only side payload (never sent to the model - see tool-loop.ts's
// executeToolCall, which recognizes this tool's { result, pendingAction }
// return shape by name, the same way createTask's own PendingTaskActionRef
// is kept out of the model-facing tool_result content). `changes` here
// contains only the fields actually proposed - never a manufactured entry
// for something the model didn't mention.
export interface UpdateTaskPendingActionRef {
  actionType: "UPDATE_TASK";
  actionId: string;
  taskId: string;
  taskTitle: string;
  expiresAt: string;
  changes: FieldChange[];
}

// This tool NEVER calls taskService.updateTask (and never will - see
// pending-task-action.service.ts's own doc comment). It only proposes: it
// validates the request exactly as the real PATCH /tasks/:id API would,
// then stages a PendingTaskAction row (actionType: "UPDATE_TASK") for a
// separately-authenticated confirmation step (Phase 24 Step 3, not
// implemented here) to act on. The model-facing result never claims the
// task was updated.
export const updateTaskTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "updateTask",
  description:
    "Propose updating an existing task's fields (title, description, status, priority, assignee, due date). This does NOT update the task immediately - it stages a proposal that the user must explicitly review and confirm in the app UI before anything is written. Only include the fields you actually want to change; any field you omit is left completely untouched. Use this when the user asks you to change/update/reassign/reschedule an existing task. After calling this, tell the user a proposal is ready for their review; never say the task has been updated.",
  schema,
  handler: async (args, ctx) => {
    // Same authorization boundary the real, human-facing PATCH /tasks/:id
    // API uses (task.service.ts's updateTask) - reused via the same
    // getTaskAccess/assertRole/assertAssigneeIsProjectMember functions,
    // not a second, parallel permission check. getTaskAccess itself 404s
    // (never 403) for a nonexistent task or one outside the caller's
    // projects, before role is even considered.
    const { task, projectId, role } = await getTaskAccess(args.taskId, ctx.userId);
    assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

    // Only re-checked when the model is actually proposing a new,
    // non-null assignee - unassigning (null) or leaving it untouched
    // (undefined) never needs this check, same rule task.service.ts's
    // own updateTask already follows.
    if (args.assigneeId !== undefined && args.assigneeId !== null) {
      await assertAssigneeIsProjectMember(projectId, args.assigneeId);
    }

    // Explicit allow-list copy - never `{...args}`, which would also
    // carry taskId and would rely on JSON already having dropped any
    // `undefined` value as the only safety net rather than an intentional
    // per-field check. This is what guarantees a field the model never
    // mentioned can never end up in `changes`.
    const changes: UpdateTaskProposedChanges = {};
    if (args.title !== undefined) changes.title = args.title;
    if (args.description !== undefined) changes.description = args.description;
    if (args.status !== undefined) changes.status = args.status;
    if (args.priority !== undefined) changes.priority = args.priority;
    if (args.assigneeId !== undefined) changes.assigneeId = args.assigneeId;
    if (args.dueDate !== undefined) changes.dueDate = args.dueDate;

    // Belt-and-suspenders alongside the schema's own .refine() above - a
    // no-op proposal (nothing to actually change) is never staged,
    // regardless of how `changes` ended up empty.
    if (Object.keys(changes).length === 0) {
      throw new AppError(400, "At least one field must be provided to update.");
    }

    if (!ctx.conversationId) {
      throw new Error("updateTask requires a conversation-scoped context");
    }

    // The task BEFORE the proposed changes - taken from the exact same
    // `task` row getTaskAccess already fetched above, never a second
    // query. dueDate/updatedAt are Prisma Date objects on this row; both
    // are stored as ISO strings, matching how every other timestamp
    // crossing this boundary (e.g. PendingTaskAction.expiresAt below) is
    // represented.
    const snapshot: UpdateTaskProposedSnapshot = {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      updatedAt: task.updatedAt.toISOString(),
    };

    const proposedInput: UpdateTaskProposedInput = { changes, snapshot };

    const pendingAction = await createPendingTaskAction({
      conversationId: ctx.conversationId,
      projectId,
      userId: ctx.userId,
      actionType: "UPDATE_TASK",
      taskId: args.taskId,
      // Prisma's InputJsonValue requires an index-signature-compatible
      // shape, which a named TS interface never structurally satisfies -
      // the same reason a plain object literal (rather than this typed
      // one) is what every other Json field write in this codebase uses.
      // The actual runtime value is unchanged: still exactly
      // { changes, snapshot } as declared above.
      proposedInput: proposedInput as unknown as Prisma.InputJsonValue,
    });

    // The UI-facing diff, built the same explicit, field-by-field way
    // `changes` itself was: an entry only exists for a field the model
    // actually proposed, "from" always comes from the snapshot (the
    // task's real value), "to" always comes from `changes` (what was
    // proposed) - never a manufactured entry for an omitted field, and
    // never a value read from anywhere the model could have influenced
    // beyond its own validated `changes`.
    const fieldChanges: FieldChange[] = [];
    if (changes.title !== undefined) {
      fieldChanges.push({ field: "title", from: snapshot.title, to: changes.title });
    }
    if (changes.description !== undefined) {
      fieldChanges.push({ field: "description", from: snapshot.description, to: changes.description });
    }
    if (changes.status !== undefined) {
      fieldChanges.push({ field: "status", from: snapshot.status, to: changes.status });
    }
    if (changes.priority !== undefined) {
      fieldChanges.push({ field: "priority", from: snapshot.priority, to: changes.priority });
    }
    if (changes.assigneeId !== undefined) {
      fieldChanges.push({ field: "assigneeId", from: snapshot.assigneeId, to: changes.assigneeId });
    }
    if (changes.dueDate !== undefined) {
      fieldChanges.push({ field: "dueDate", from: snapshot.dueDate, to: changes.dueDate });
    }

    const pendingActionRef: UpdateTaskPendingActionRef = {
      actionType: "UPDATE_TASK",
      actionId: pendingAction.id,
      taskId: args.taskId,
      taskTitle: task.title,
      expiresAt: pendingAction.expiresAt.toISOString(),
      changes: fieldChanges,
    };

    // Model-facing result is deliberately minimal: no snapshot, no
    // internal ids beyond the action id itself, no database internals -
    // just enough for the model to refer to the proposal in its own next
    // sentence, and it never claims the task was actually updated. The
    // richer pendingActionRef above is UI-only, kept out of this object
    // exactly like createTask's own pendingAction is (see tool-loop.ts's
    // executeToolCall, which now recognizes this tool by name too).
    return {
      result: {
        status: "pending_confirmation",
        actionId: pendingAction.id,
        summary: `Proposed an update to task "${task.title}" — awaiting your confirmation.`,
      },
      pendingAction: pendingActionRef,
    };
  },
};
