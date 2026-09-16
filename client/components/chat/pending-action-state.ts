import { ApiError } from "@/lib/api";

// Tracks the lifecycle of a confirm/cancel request against a
// PendingTaskActionRef, kept entirely separate from that ref itself (which
// stays the immutable proposal payload the server sent - see
// lib/ai-chat.ts). Local-only, per-hook-instance state; not persisted, not
// global (Zustand or otherwise).
export type PendingActionStatus = "pending" | "confirming" | "cancelling" | "confirmed" | "cancelled" | "error";

export interface PendingActionState {
  status: PendingActionStatus;
  // Which operation this status came from - set whenever confirmAction/
  // cancelAction starts, and preserved through to "error" so a Retry
  // action can repeat the same operation instead of guessing (Phase 19
  // Step 7B-3). Not meaningful before either has ever been called (the
  // initial "pending" state has no lastAction).
  lastAction?: "confirm" | "cancel";
  // Populated only after a successful confirm - the future UI can use this
  // to show what was actually created without a second fetch.
  task?: import("@/lib/types").Task;
  // A user-safe message only (ApiError's own .message, which already
  // mirrors the server's own error envelope - see lib/api.ts). Never a raw
  // Error.message from an unexpected exception shape.
  error?: string;
}

export type PendingActionStateMap = Record<string, PendingActionState>;

// True when a confirm/cancel request for this action is already in flight -
// the single guard that keeps confirm/cancel mutually exclusive and
// prevents a duplicate request for the same action.
export function isActionBusy(state: PendingActionState | undefined): boolean {
  return state?.status === "confirming" || state?.status === "cancelling";
}

// Pure helper so the confirm/cancel catch blocks below don't each
// reimplement "what's a safe string to show for this failure" - mirrors the
// message the server itself chose to send (ApiError.message), and falls
// back to a fixed generic string for anything else (a network failure, an
// unexpected throw shape) rather than ever surfacing a raw Error.message or
// stack.
export function toSafeActionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}
