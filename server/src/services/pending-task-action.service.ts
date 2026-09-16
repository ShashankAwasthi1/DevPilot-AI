import type { PendingTaskAction } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AI_LIMITS } from "../ai/limits";
import { AppError } from "../utils/AppError";
import { createTask as createTaskViaService, type TaskDto } from "./task.service";
import { createTaskSchema, type CreateTaskInput } from "../validation/task.validation";

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

// Exact wording approved in the Phase 19 Step 7 design - kept as named
// constants so confirm/cancel below (and their tests) never risk the two
// messages drifting apart from typos.
const NOT_PENDING_MESSAGE = "This proposal is no longer pending";
const EXPIRED_MESSAGE = "This proposal has expired";
const NOT_FOUND_MESSAGE = "Pending action not found";

// A stored error message is bounded the same way every other
// user-eventually-visible error text in this codebase is (see e.g.
// gemini.provider.ts's safeReadBody) - never the full raw error, never a
// stack trace. An AppError's own .message is already a curated, safe
// string by construction throughout this codebase (it's what every
// existing controller already returns to a client via errorHandler.ts),
// so it's safe to store verbatim (bounded defensively anyway); anything
// else (an unexpected non-AppError) gets a fixed generic fallback instead
// of its own possibly-sensitive message.
const RESULT_ERROR_MAX_CHARS = 500;

function toSafeResultError(err: unknown): string {
  const message = err instanceof AppError ? err.message : "Task creation failed.";
  return message.slice(0, RESULT_ERROR_MAX_CHARS);
}

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
): Promise<TaskDto> {
  const action = await findOwnedPendingTaskAction(actionId, projectId, conversationId, userId);

  if (action.status !== "PENDING") {
    throw new AppError(409, NOT_PENDING_MESSAGE);
  }

  if (action.expiresAt.getTime() <= Date.now()) {
    throw new AppError(409, EXPIRED_MESSAGE);
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
