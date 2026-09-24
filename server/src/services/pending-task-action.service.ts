import { z } from "zod";
import type { PendingTaskAction, PendingTaskActionType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AI_LIMITS } from "../ai/limits";
import { AppError } from "../utils/AppError";
import {
  assertAssigneeIsProjectMember,
  createTask as createTaskViaService,
  getTaskAccess,
  updateTask as updateTaskViaService,
  type TaskDto,
} from "./task.service";
import { assertRole, getProjectAccess } from "./project.service";
import { createTaskSchema, updateTaskSchema, type CreateTaskInput } from "../validation/task.validation";

export interface CreatePendingTaskActionParams {
  conversationId: string;
  projectId: string;
  userId: string;
  // Defaults to "CREATE_TASK" below (matching the schema's own column
  // default) so create-task.tool.ts's existing call site - which never
  // passes this - needs no change at all. update-task.tool.ts (Phase 24)
  // passes "UPDATE_TASK" explicitly, alongside `taskId`.
  actionType?: PendingTaskActionType;
  // Only meaningful (and only ever passed) for an UPDATE_TASK proposal -
  // there's no existing task for a CREATE_TASK proposal to point at.
  taskId?: string;
  // Widened from CreateTaskInput (Phase 19) to also accept an
  // UPDATE_TASK proposal's own { changes, snapshot } shape (Phase 24) -
  // this function has never inspected or validated the shape of this
  // value, only persisted it verbatim (see the doc comment below), so
  // widening it to any JSON-serializable value changes no behavior here.
  proposedInput: CreateTaskInput | Prisma.InputJsonValue;
}

// Persists an AI-proposed task creation or update for later, separately-
// authenticated confirmation (create: Phase 19; update: Phase 24's later
// confirm step, not implemented here). This function NEVER mutates a Task
// itself; it only records the proposal. `proposedInput` must already be
// the calling tool's own fully-validated output before it reaches here -
// this function does not re-validate its fields, it only persists them
// verbatim, since the confirm step (later) must execute exactly what was
// proposed, never a value edited in between.
//
// No authorization check lives here - role/assignee validation happens in
// the caller (create-task.tool.ts / update-task.tool.ts), reusing
// project.service.ts's/task.service.ts's existing functions, so this
// service has exactly one job: create the row.
// Phase 22 Step 5 - only counts rows still genuinely open (status PENDING);
// CONFIRMED/CANCELLED/EXPIRED rows are resolved and never count against the
// cap, regardless of how many of those a user has accumulated over time.
const TOO_MANY_PENDING_ACTIONS_MESSAGE =
  "You have too many pending proposals awaiting confirmation. Please confirm or cancel some before proposing more";

export async function createPendingTaskAction(
  params: CreatePendingTaskActionParams,
): Promise<PendingTaskAction> {
  const openCount = await prisma.pendingTaskAction.count({
    where: { userId: params.userId, status: "PENDING" },
  });
  if (openCount >= AI_LIMITS.MAX_OPEN_PENDING_ACTIONS) {
    throw new AppError(429, TOO_MANY_PENDING_ACTIONS_MESSAGE);
  }

  return prisma.pendingTaskAction.create({
    data: {
      conversationId: params.conversationId,
      projectId: params.projectId,
      userId: params.userId,
      actionType: params.actionType ?? "CREATE_TASK",
      taskId: params.taskId,
      proposedInput: params.proposedInput,
      expiresAt: new Date(Date.now() + AI_LIMITS.PENDING_TASK_ACTION_TTL_MS),
    },
  });
}

// Exact wording approved in the Phase 19 Step 7 design - kept as named
// constants so confirm/cancel below (and their tests) never risk the two
// messages drifting apart from typos.
const NOT_PENDING_MESSAGE = "This proposal is no longer pending";
const EXPIRED_MESSAGE = "This proposal has expired";
const NOT_FOUND_MESSAGE = "Pending action not found";
// Phase 24: distinct from NOT_PENDING_MESSAGE on purpose - the caller who
// actually triggers this detection gets a specific, actionable reason
// (the task itself changed), while anyone who loses the race to that
// same detection (or to a genuine concurrent confirm/cancel) still gets
// the generic "no longer pending" message, since from their perspective
// that's all that's actually true.
const STALE_MESSAGE = "This task has changed since this proposal was made. Please ask the AI to create a new proposal.";

// A stored error message is bounded the same way every other
// user-eventually-visible error text in this codebase is (see e.g.
// gemini.provider.ts's safeReadBody) - never the full raw error, never a
// stack trace. An AppError's own .message is already a curated, safe
// string by construction throughout this codebase (it's what every
// existing controller already returns to a client via errorHandler.ts),
// so it's safe to store verbatim (bounded defensively anyway); anything
// else (an unexpected non-AppError) gets a fixed generic fallback instead
// of its own possibly-sensitive message. `fallback` defaults to the
// original CREATE_TASK wording so that call site needs no change; the
// UPDATE_TASK branch below passes its own.
const RESULT_ERROR_MAX_CHARS = 500;

function toSafeResultError(err: unknown, fallback = "Task creation failed."): string {
  const message = err instanceof AppError ? err.message : fallback;
  return message.slice(0, RESULT_ERROR_MAX_CHARS);
}

// Mirrors update-task.tool.ts's own UpdateTaskProposedSnapshot shape -
// redeclared here (not imported) since services never depend on the AI
// tool layer, only the reverse. Re-validated the same defensive way a
// CREATE_TASK proposal's proposedInput is re-parsed below: never trust a
// stored JSON blob as still correctly-shaped just because it was valid
// once at propose time.
const updateTaskSnapshotSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  assigneeId: z.string().nullable(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
});

// `changes` reuses the exact same schema the real, human-facing
// PATCH /tasks/:id endpoint validates against (updateTaskSchema) - same
// "never trust the stored blob, re-validate through the real schema"
// discipline createTaskSchema.parse() already applies to a CREATE_TASK
// proposal below. Unknown keys inside `changes` are silently stripped
// (not rejected), matching updateTaskSchema's own existing convention -
// so an unexpected persisted field can never become part of the actual
// update passed to taskService.updateTask.
const updateTaskProposalSchema = z.object({
  changes: updateTaskSchema,
  snapshot: updateTaskSnapshotSchema,
});

type UpdateTaskProposal = z.infer<typeof updateTaskProposalSchema>;

// Mirrors generate-project-plan.tool.ts's own schema exactly - redeclared
// here (not imported) for the same reason updateTaskSnapshotSchema/
// updateTaskProposalSchema above are: services never depend on the AI tool
// layer, only the reverse. Re-validated the same defensive way every other
// proposedInput on this model is - never trust a stored JSON blob as
// still correctly-shaped just because it passed the tool's own schema once
// at propose time.
const projectPlanTaskSchema = z
  .object({
    tempId: z.string().trim().min(1).max(20),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).nullable().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  })
  .strict();

const projectPlanProposalSchema = z
  .object({
    planTitle: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).nullable().optional(),
    tasks: z.array(projectPlanTaskSchema).min(1).max(AI_LIMITS.MAX_PLAN_TASKS),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const task of value.tasks) {
      if (ids.has(task.tempId)) {
        ctx.addIssue({ code: "custom", path: ["tasks"], message: "Task tempId values must be unique." });
        break;
      }
      ids.add(task.tempId);
    }
  });

type ProjectPlanProposal = z.infer<typeof projectPlanProposalSchema>;

// Looks up a PendingTaskAction scoped by all four identifying values at
// once - actionId, projectId, conversationId, AND userId - so a valid
// actionId can never be paired with someone else's userId, or a different
// project/conversation, to access or act on it. Same double/triple-key
// idiom as conversation.service.ts's getConversationAccess/
// document.service.ts's getDocumentAccess, extended to four keys here
// since a pending action is scoped to all three parent resources plus its
// own proposer. A mismatch on ANY of the four is indistinguishable from
// "doesn't exist" (404), never a 403 - so a caller can never learn whether
// an action exists for a different user/project/conversation.
async function findOwnedPendingTaskAction(
  actionId: string,
  projectId: string,
  conversationId: string,
  userId: string,
): Promise<PendingTaskAction> {
  const action = await prisma.pendingTaskAction.findFirst({
    where: { id: actionId, projectId, conversationId, userId },
  });

  if (!action) {
    throw new AppError(404, NOT_FOUND_MESSAGE);
  }

  return action;
}

// Confirms an AI-proposed task creation, executing it for real. The only
// code path in this entire codebase that turns a PendingTaskAction into an
// actual Task - and even this path never calls prisma.task.create
// directly, it delegates 100% to the existing, unmodified
// task.service.ts's createTask(), so authorization/assignee-validation/
// field-writing logic is never duplicated.
//
// Ordering matters here and mirrors the approved design exactly:
//   1. resolve + ownership-check (404)
//   2. reject non-PENDING / expired (409, before ever touching status)
//   3. re-validate the stored proposal (never trust it as already-safe)
//   4. ONLY THEN attempt the atomic PENDING -> CONFIRMED claim
//   5. ONLY IF that claim actually affected a row, create the real Task
export async function confirmPendingTaskAction(
  actionId: string,
  projectId: string,
  conversationId: string,
  userId: string,
): Promise<TaskDto | TaskDto[]> {
  const action = await findOwnedPendingTaskAction(actionId, projectId, conversationId, userId);

  if (action.status !== "PENDING") {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  if (action.expiresAt.getTime() <= Date.now()) {
    throw new AppError(409, EXPIRED_MESSAGE);
  }

  // The shared ownership/PENDING/expiry checks above apply identically to
  // every proposal type - only what happens next (re-validation, the
  // authorization re-check, and which service function actually mutates)
  // differs, so each is split into its own function rather than growing
  // this one into several interleaved code paths.
  if (action.actionType === "UPDATE_TASK") {
    return confirmUpdateTaskAction(action);
  }

  if (action.actionType === "CREATE_PROJECT_PLAN") {
    return confirmCreateProjectPlanAction(action);
  }

  // Re-parsed through the exact same schema the real, human-facing
  // createTask endpoint uses - never trust the persisted JSON blob as
  // already-safe just because it passed the AI tool's own (structurally
  // equivalent, but separately-defined) schema once at propose time.
  // createTaskSchema does not declare projectId/userId/createdById, so
  // even a hypothetically-tampered stored blob could never inject them
  // here - they are supplied to createTaskViaService below as separate
  // arguments (from this row's own columns), never read out of this
  // parsed object.
  let validatedInput: CreateTaskInput;
  try {
    validatedInput = createTaskSchema.parse(action.proposedInput);
  } catch {
    // A stored proposal that no longer parses is a data-integrity issue,
    // not something confirming again would fix - but it also isn't the
    // caller's fault, so the action is left PENDING (not consumed) rather
    // than burned on an internal inconsistency.
    throw new AppError(500, "Something went wrong creating the task.");
  }

  // The single atomic boundary, and the entire replay/race-prevention
  // mechanism: only a caller whose update actually affects a row has
  // "won" the right to create the Task. The WHERE clause re-checks
  // status/expiresAt against the database's current state at the moment
  // of the write (not the values read above), closing the gap between
  // the reads above and this write - this is what makes double-clicking
  // Confirm, a network retry, or a genuine concurrent request all safe
  // without any separate idempotency-key system.
  const claimed = await prisma.pendingTaskAction.updateMany({
    where: { id: actionId, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  if (claimed.count === 0) {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  let task: TaskDto;
  try {
    task = await createTaskViaService(action.userId, action.projectId, validatedInput);
  } catch (err) {
    // The action stays CONFIRMED - never reverted to PENDING, and this
    // actionId can never be confirmed again (the atomic claim above has
    // already consumed it). Only a short, bounded, safe message is
    // stored; the real error (which may be an AppError from a stale-role/
    // stale-assignee re-check, or something unexpected) still propagates
    // to the caller below exactly as thrown, so the HTTP response gets
    // whatever status code that error already carries (errorHandler.ts
    // maps a non-AppError to a generic 500 automatically).
    await prisma.pendingTaskAction
      .update({ where: { id: actionId }, data: { resultError: toSafeResultError(err) } })
      .catch((bookkeepingErr) => {
        console.error(`Failed to record resultError for pending action ${actionId}:`, bookkeepingErr);
      });
    throw err;
  }

  try {
    await prisma.pendingTaskAction.update({ where: { id: actionId }, data: { resultTaskId: task.id } });
  } catch (err) {
    // The Task was already created successfully above - never delete it
    // and never retry creation just because this bookkeeping write
    // failed. Logged so the inconsistency (a CONFIRMED row with no
    // resultTaskId despite a real Task existing) is at least visible.
    console.error(`Failed to record resultTaskId for pending action ${actionId}:`, err);
  }

  return task;
}

// Confirms an AI-proposed task UPDATE, executing it for real. Mirrors the
// CREATE_TASK path above in every structural respect (re-validate, THEN
// atomically claim, THEN mutate via the existing service function, never
// prisma.task.update directly) with two differences unique to updating an
// *existing* resource: authorization must be re-checked against the
// task's current state (not just re-parsed from what was proposed), and a
// proposal whose basis (the task's updatedAt) is no longer current must
// never be silently applied.
//
// Ordering, and why it avoids the race the design explicitly calls out:
//   1. re-validate the stored proposal shape (never trust it as already-safe)
//   2. re-check authorization against LIVE data (getTaskAccess/assertRole/
//      assertAssigneeIsProjectMember) - the proposal's own propose-time
//      snapshot is never treated as still valid
//   3. compare the task's CURRENT updatedAt against the snapshot captured
//      at propose time - if it differs, atomically move PENDING -> EXPIRED
//      (guarded exactly like the claim below) and reject, rather than
//      leaving a proposal that can never legitimately succeed sitting in
//      PENDING forever
//   4. ONLY THEN attempt the atomic PENDING -> CONFIRMED claim
//   5. ONLY IF that claim actually affected a row, call taskService.updateTask
// The claim in step 4 - not the staleness check in step 3 - is what
// actually prevents two concurrent confirmations from both mutating the
// task: since status="PENDING" is a precondition of that update, only one
// concurrent caller's updateMany can ever affect a row, regardless of
// what each caller separately computed for staleness. The staleness check
// exists to guard the *correctness of the value being written*, not to
// provide mutual exclusion - that guarantee comes entirely from the claim.
async function confirmUpdateTaskAction(action: PendingTaskAction): Promise<TaskDto> {
  let proposal: UpdateTaskProposal;
  try {
    proposal = updateTaskProposalSchema.parse(action.proposedInput);
  } catch {
    throw new AppError(500, "Something went wrong updating the task.");
  }

  if (!action.taskId) {
    // Defensive-only: update-task.tool.ts never creates an UPDATE_TASK row
    // without a taskId - this can only mean a data-integrity issue, never
    // anything a caller did.
    throw new AppError(500, "Something went wrong updating the task.");
  }

  // Re-checked against the task's CURRENT state, never trusted from
  // propose time: the task or the caller's project access could be gone,
  // the caller's role could have changed, and (below) the proposed
  // assignee could have left the project since this proposal was made.
  // Same functions taskService.updateTask itself uses internally - reused,
  // not reimplemented - so this is a second, harmless pass through the
  // same authorization boundary, not a parallel one.
  const { task, projectId, role } = await getTaskAccess(action.taskId, action.userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  if (proposal.changes.assigneeId) {
    await assertAssigneeIsProjectMember(projectId, proposal.changes.assigneeId);
  }

  // Stale-proposal protection: Task.updatedAt already changes on every
  // write (Prisma's @updatedAt) - comparing it against the snapshot
  // captured at propose time is a free, zero-new-schema optimistic-
  // concurrency check. If anyone (a human, or another confirmed proposal)
  // has changed this task since the AI proposed this update, confirming
  // now would silently apply a decision made against information that's
  // no longer current.
  if (task.updatedAt.getTime() !== new Date(proposal.snapshot.updatedAt).getTime()) {
    // Never left PENDING to be retried forever - reusing the existing
    // EXPIRED status (not inventing a new one) since its own doc comment
    // already anticipates exactly this: marking a PENDING row stale
    // without a schema change. Guarded by the same atomic, status-scoped
    // updateMany as every other state transition on this model, so two
    // concurrent stale detections (or a stale detection racing a genuine
    // confirm/cancel) can never both "win".
    const staleClaim = await prisma.pendingTaskAction.updateMany({
      where: { id: action.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    if (staleClaim.count > 0) {
      throw new AppError(409, STALE_MESSAGE);
    }
    // Someone else already moved this action out of PENDING first (a
    // genuine concurrent confirm/cancel, or another request's own stale
    // detection) - from this caller's perspective it's simply no longer
    // pending, same generic message as every other already-resolved case.
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  // The single atomic boundary and the entire replay/race-prevention
  // mechanism for a genuinely-fresh proposal - identical mechanics to the
  // CREATE_TASK claim above.
  const claimed = await prisma.pendingTaskAction.updateMany({
    where: { id: action.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  if (claimed.count === 0) {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  let updatedTask: TaskDto;
  try {
    // Only the validated `changes` - never taskId, snapshot, actionType,
    // or any other persisted field - and taskService.updateTask remains
    // the one and only mutation authority. It never receives anything
    // beyond what the model actually proposed and what re-validation
    // above just confirmed is still safe to apply.
    updatedTask = await updateTaskViaService(action.userId, action.taskId, proposal.changes);
  } catch (err) {
    // The action stays CONFIRMED - never reverted to PENDING, and this
    // actionId can never be confirmed again (the atomic claim above has
    // already consumed it). Same bookkeeping discipline as the CREATE_TASK
    // failure path above, with an update-specific fallback message.
    await prisma.pendingTaskAction
      .update({ where: { id: action.id }, data: { resultError: toSafeResultError(err, "Task update failed.") } })
      .catch((bookkeepingErr) => {
        console.error(`Failed to record resultError for pending action ${action.id}:`, bookkeepingErr);
      });
    throw err;
  }

  try {
    await prisma.pendingTaskAction.update({ where: { id: action.id }, data: { resultTaskId: updatedTask.id } });
  } catch (err) {
    console.error(`Failed to record resultTaskId for pending action ${action.id}:`, err);
  }

  return updatedTask;
}

// Confirms an AI-proposed multi-task project plan, executing it for real.
// Mirrors confirmUpdateTaskAction/the CREATE_TASK path above in every
// structural respect (re-validate the stored proposal, re-check LIVE
// authorization, THEN atomically claim, THEN mutate via the existing
// service function, never prisma.task.create directly) - with one
// addition unique to a plan: every proposed task must be created inside a
// single Prisma transaction, so a failure partway through leaves none of
// them behind rather than a partial plan.
//
// Ordering:
//   1. re-validate the stored proposal shape (never trust it as already-safe)
//   2. re-check LIVE authorization (getProjectAccess/assertRole) - a plan
//      has no single existing task to re-check against (unlike
//      UPDATE_TASK's staleness check), so this re-checks the project
//      itself, exactly like generateProjectPlanTool's own propose-time
//      check
//   3. ONLY THEN attempt the atomic PENDING -> CONFIRMED claim
//   4. ONLY IF that claim actually affected a row, create every task
//      inside one prisma.$transaction, passing the SAME tx to every
//      taskService.createTask call - if any call throws, the whole
//      transaction (and therefore every task already created inside it)
//      rolls back together, so no partial plan can ever be persisted
async function confirmCreateProjectPlanAction(action: PendingTaskAction): Promise<TaskDto[]> {
  let proposal: ProjectPlanProposal;
  try {
    proposal = projectPlanProposalSchema.parse(action.proposedInput);
  } catch {
    throw new AppError(500, "Something went wrong creating the project plan.");
  }

  // Re-checked against the project's CURRENT membership, never trusted
  // from propose time - the caller's role could have changed (or they
  // could have lost access to the project entirely) since the plan was
  // proposed. Same functions generateProjectPlanTool itself uses to
  // authorize the original proposal, reused rather than reimplemented.
  const { role } = await getProjectAccess(action.projectId, action.userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  // The single atomic boundary and the entire replay/race-prevention
  // mechanism - identical mechanics to the CREATE_TASK/UPDATE_TASK claims
  // above. Only a caller whose claim actually affects a row may proceed to
  // create any tasks; a second confirmation (or a confirm racing a
  // cancel) can never also win it.
  const claimed = await prisma.pendingTaskAction.updateMany({
    where: { id: action.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  if (claimed.count === 0) {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  let createdTasks: TaskDto[];
  try {
    // Every proposed task is created inside this ONE transaction, strictly
    // in proposal order, all via the same `tx` - never a mix of `tx` and
    // the global `prisma` for tasks belonging to the same plan. If any
    // single createTask call throws, the transaction callback rejects and
    // Prisma rolls back every write already performed inside it (including
    // any per-task notification write createTask itself might issue) - no
    // task from this plan can ever survive a partial failure.
    createdTasks = await prisma.$transaction(async (tx) => {
      const tasks: TaskDto[] = [];
      for (const proposedTask of proposal.tasks) {
        // Only title/description/priority are ever mapped - no
        // assigneeId, dueDate, or dependency data, matching
        // generateProjectPlanTool's own deliberately narrow schema.
        // status is always the same server-side default createTaskSchema
        // itself would apply (TODO); projectId/userId come from this
        // action's own columns, never from the stored proposal.
        const task = await createTaskViaService(
          action.userId,
          action.projectId,
          {
            title: proposedTask.title,
            description: proposedTask.description ?? null,
            status: "TODO",
            priority: proposedTask.priority,
          },
          tx,
        );
        tasks.push(task);
      }
      return tasks;
    });
  } catch (err) {
    // The action stays CONFIRMED - never reverted to PENDING, and this
    // actionId can never be confirmed again (the atomic claim above has
    // already consumed it). Same bookkeeping discipline as both existing
    // confirm paths, with a plan-specific fallback message. No task from
    // this failed transaction was ever committed, so resultTaskIds is left
    // at its schema default (empty array) rather than recording anything.
    await prisma.pendingTaskAction
      .update({
        where: { id: action.id },
        data: { resultError: toSafeResultError(err, "Project plan creation failed.") },
      })
      .catch((bookkeepingErr) => {
        console.error(`Failed to record resultError for pending action ${action.id}:`, bookkeepingErr);
      });
    throw err;
  }

  try {
    await prisma.pendingTaskAction.update({
      where: { id: action.id },
      data: { resultTaskIds: createdTasks.map((task) => task.id) },
    });
  } catch (err) {
    // The tasks were already created successfully above - never delete
    // them and never retry creation just because this bookkeeping write
    // failed. Logged so the inconsistency is at least visible, exactly
    // like the CREATE_TASK/UPDATE_TASK paths' own resultTaskId bookkeeping.
    console.error(`Failed to record resultTaskIds for pending action ${action.id}:`, err);
  }

  return createdTasks;
}

export interface CancelPendingTaskActionResult {
  actionId: string;
  status: "CANCELLED";
}

// Cancels a proposal. Structurally the same ownership/status/expiry
// checks as confirm above, minus any Task-creation step - cancellation
// never creates anything, ever.
export async function cancelPendingTaskAction(
  actionId: string,
  projectId: string,
  conversationId: string,
  userId: string,
): Promise<CancelPendingTaskActionResult> {
  const action = await findOwnedPendingTaskAction(actionId, projectId, conversationId, userId);

  if (action.status !== "PENDING") {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  if (action.expiresAt.getTime() <= Date.now()) {
    throw new AppError(409, EXPIRED_MESSAGE);
  }

  // Same atomic-claim idiom as confirm, guarding only on status - a
  // concurrent confirm and cancel race to this same status=PENDING guard
  // (on their respective updateMany calls), so exactly one of them can
  // ever win, regardless of which one runs first.
  const claimed = await prisma.pendingTaskAction.updateMany({
    where: { id: actionId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  if (claimed.count === 0) {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  return { actionId, status: "CANCELLED" };
}
