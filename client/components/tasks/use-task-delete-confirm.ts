"use client";

import { useState, type MouseEvent } from "react";
import { ApiError } from "@/lib/api";

export interface UseTaskDeleteConfirmResult {
  confirming: boolean;
  deleting: boolean;
  error: string | null;
  start: (event: MouseEvent) => void;
  cancel: (event: MouseEvent) => void;
  confirm: (event: MouseEvent) => void;
}

// Shared delete-confirmation state, extracted so both the List row
// (TaskRow, task-list.tsx) and the Kanban card (task-kanban.tsx) get
// identical confirm/cancel/delete behavior without either one
// reimplementing it - same inline confirm-swap UX pattern ConversationRow
// established in Phase 16 Step 8, just no longer duplicated per presentation.
export function useTaskDeleteConfirm(
  taskId: string,
  onDelete: (taskId: string) => Promise<void>,
): UseTaskDeleteConfirmResult {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start(event: MouseEvent) {
    event.stopPropagation();
    setError(null);
    setConfirming(true);
  }

  function cancel(event: MouseEvent) {
    event.stopPropagation();
    setConfirming(false);
    setError(null);
  }

  async function confirm(event: MouseEvent) {
    event.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(taskId);
      // On success, the parent's refetch removes this task entirely once
      // it lands - nothing further to do here.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  return { confirming, deleting, error, start, cancel, confirm };
}
