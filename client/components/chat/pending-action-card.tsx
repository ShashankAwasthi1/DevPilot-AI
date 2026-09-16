"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CircleCheck, CircleX, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PendingActionRef } from "@/lib/ai-chat";
import { FIELD_LABEL, formatFieldValue } from "@/lib/pending-action-format";
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/components/tasks/task-labels";
import type { ProjectMember } from "@/lib/types";
import type { PendingActionState } from "./pending-action-state";

export interface PendingActionCardProps {
  action: PendingActionRef;
  state: PendingActionState;
  onConfirm: (actionId: string) => Promise<void>;
  onCancel: (actionId: string) => Promise<void>;
  // Optional, and only ever used to resolve an UPDATE_TASK change's
  // assigneeId to a display name (see lib/pending-action-format.ts) - the
  // chat surface this card renders in doesn't currently load a project's
  // member list, so this defaults to empty and assignee changes fall back
  // to a safe "Unknown member"/"Unassigned" label. Never used to fetch
  // anything - purely a lookup against whatever the caller already has.
  members?: ProjectMember[];
}

// The task title this proposal is about, regardless of which variant it
// is - used for both the button aria-labels and the confirmed/cancelled
// status text, so neither has to branch on actionType a second time.
function proposalTitle(action: PendingActionRef): string {
  return action.actionType === "CREATE_TASK" ? action.title : action.taskTitle;
}

// Purely presentational - no fetch, no api.ts import, no knowledge of
// projectId/conversationId. Every button here calls straight back into the
// callbacks useChatTurn already exposes (confirmAction/cancelAction), which
// already own the one PendingActionState this card renders (see
// pending-action-state.ts) - there is no second status machine in here,
// and `action` (the PendingActionRef prop) is only ever read, never
// mutated.
export function PendingActionCard({ action, state, onConfirm, onCancel, members = [] }: PendingActionCardProps) {
  const { expired, remainingLabel } = useExpiryStatus(action.expiresAt, state.status);
  const prefersReducedMotion = useReducedMotion();
  const busy = state.status === "confirming" || state.status === "cancelling";
  const settled = state.status === "confirmed" || state.status === "cancelled";
  const buttonsDisabled = busy || settled || expired;
  const title = proposalTitle(action);

  function handleRetry() {
    // Retries whichever operation actually failed, per Phase 19 Step
    // 7B-3's requirement - never guesses, never resets the proposal, and
    // never mints a new PendingTaskAction (onConfirm/onCancel both call
    // straight into the existing confirmPendingTaskAction/
    // cancelPendingTaskAction against the same actionId). For a stale
    // UPDATE_TASK proposal (see pending-task-action.service.ts's
    // confirmUpdateTaskAction), the action is already terminal server-side
    // by the time this error exists, so retrying surfaces the same
    // rejection rather than ever silently succeeding - never an
    // automatic retry, only ever in response to an explicit click.
    if (state.lastAction === "cancel") {
      void onCancel(action.actionId);
    } else {
      void onConfirm(action.actionId);
    }
  }

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <Card
        className={cn(
          "mt-1.5 max-w-md ring-1",
          state.status === "cancelled" && "opacity-60",
          state.status === "error" ? "ring-destructive/30" : "ring-border",
        )}
      >
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Action proposal</span>
          </div>

          {action.actionType === "CREATE_TASK" ? (
            <CreateTaskProposal action={action} />
          ) : (
            <UpdateTaskProposal action={action} members={members} />
          )}

          <div aria-live="polite" className="min-h-4 text-xs">
            {state.status === "confirmed" && (
              <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-500">
                <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {action.actionType === "CREATE_TASK" ? "Task created" : "Task updated"}
                  {state.task ? `: "${state.task.title}"` : ""}
                </span>
              </p>
            )}
            {state.status === "cancelled" && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Action cancelled</span>
              </p>
            )}
            {state.status === "error" && (
              <p className="flex items-center gap-1.5 text-destructive" role="alert">
                <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{state.error ?? "Something went wrong. Please try again."}</span>
              </p>
            )}
            {state.status === "pending" && (
              <p className="text-muted-foreground">{expired ? "This proposal has expired." : remainingLabel}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {state.status === "error" ? (
              <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
                Retry
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={buttonsDisabled}
                  onClick={() => void onCancel(action.actionId)}
                  aria-label={`Cancel proposed change to "${title}"`}
                >
                  {state.status === "cancelling" && (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  )}
                  {state.status === "cancelling" ? "Cancelling…" : "Cancel"}
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={buttonsDisabled}
                  onClick={() => void onConfirm(action.actionId)}
                  aria-label={`Confirm proposed change to "${title}"`}
                >
                  {state.status === "confirming" && (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  )}
                  {state.status === "confirming" ? "Confirming…" : "Confirm"}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface CreateTaskProposalProps {
  action: Extract<PendingActionRef, { actionType: "CREATE_TASK" }>;
}

function CreateTaskProposal({ action }: CreateTaskProposalProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Create task</p>
        <p className="text-sm font-medium break-words">{action.title}</p>
        {action.description && (
          <p className="text-sm break-words text-muted-foreground">{action.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={PRIORITY_BADGE_VARIANT[action.priority]}>{PRIORITY_LABEL[action.priority]}</Badge>
        <Badge variant={STATUS_BADGE_VARIANT[action.status]}>{STATUS_LABEL[action.status]}</Badge>
      </div>

      {(action.assigneeName || action.dueDate) && (
        <dl className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {action.assigneeName && (
            <div className="flex gap-1">
              <dt className="font-medium text-foreground">Assignee</dt>
              <dd>{action.assigneeName}</dd>
            </div>
          )}
          {action.dueDate && (
            <div className="flex gap-1">
              <dt className="font-medium text-foreground">Due date</dt>
              <dd>{new Date(action.dueDate).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}

interface UpdateTaskProposalProps {
  action: Extract<PendingActionRef, { actionType: "UPDATE_TASK" }>;
  members: ProjectMember[];
}

// Renders update-task.tool.ts's own field-by-field diff - every value
// shown is either a raw enum run through the same fixed STATUS_LABEL/
// PRIORITY_LABEL maps the task board already uses, or a plain string/id
// resolved via formatFieldValue (never dangerouslySetInnerHTML, never any
// HTML parsing - title/description are rendered as plain text nodes,
// exactly like the CREATE_TASK variant above and the rest of this app's
// chat surface).
function UpdateTaskProposal({ action, members }: UpdateTaskProposalProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Update task</p>
        <p className="text-sm font-medium break-words">{action.taskTitle}</p>
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        {action.changes.map((change) => (
          <div key={change.field} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">{FIELD_LABEL[change.field]}</dt>
            <dd className="flex flex-wrap items-center gap-1.5 break-words">
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                {formatFieldValue(change.field, change.from, members)}
              </span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{formatFieldValue(change.field, change.to, members)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatRemaining(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "Expires in under a minute";
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Expires in ${hours} hr${hours === 1 ? "" : "s"}`;
}

interface ExpiryStatus {
  expired: boolean;
  remainingLabel: string | null;
}

// Lazily-initialized to a non-expired state on both server and client -
// this card only ever mounts client-side, in direct response to a live
// "pending_action" SSE event, never as part of the server-rendered
// conversation history, so there is nothing to mismatch on hydration; the
// deterministic initial value just keeps that guarantee explicit rather
// than assumed. The interval is 30s (a countdown measured in minutes
// doesn't need finer resolution), is cleared on unmount, and stops itself
// the moment the deadline passes or the action leaves "pending" - it never
// polls the backend and never runs once there's nothing left to update.
function useExpiryStatus(expiresAt: string, status: PendingActionState["status"]): ExpiryStatus {
  // Lazy initializer runs once, at mount - safe because this card only
  // ever mounts client-side (see the function-level comment above), never
  // during the server-rendered pass, so there is no server/client value to
  // reconcile.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "pending") return;

    const deadline = new Date(expiresAt).getTime();
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(interval);
    }, 30_000);

    return () => clearInterval(interval);
  }, [expiresAt, status]);

  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return { expired: true, remainingLabel: null };
  return { expired: false, remainingLabel: formatRemaining(remainingMs) };
}
