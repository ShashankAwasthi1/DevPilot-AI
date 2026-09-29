import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingActionCard } from "./pending-action-card";
import type { PendingTaskActionRef } from "@/lib/ai-chat";
import type { PendingActionState } from "./pending-action-state";

const ACTION: PendingTaskActionRef = {
  actionType: "CREATE_TASK",
  actionId: "action-1",
  title: "Add dark mode support",
  description: null,
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: null,
  assigneeName: null,
  dueDate: null,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

function renderCard(state: PendingActionState, onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(<PendingActionCard action={ACTION} state={state} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

test("PendingActionCard: pending state renders enabled Confirm/Cancel controls", () => {
  renderCard({ status: "pending" });

  expect(screen.getByRole("button", { name: /confirm proposed change/i })).toBeEnabled();
  expect(screen.getByRole("button", { name: /cancel proposed change/i })).toBeEnabled();
});

test("PendingActionCard: clicking Confirm while pending calls onConfirm exactly once with the action id", async () => {
  const user = userEvent.setup();
  const { onConfirm } = renderCard({ status: "pending" });

  await user.click(screen.getByRole("button", { name: /confirm proposed change/i }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledWith("action-1");
});

test("PendingActionCard: a 'confirming' state disables both buttons and shows a busy label", () => {
  renderCard({ status: "confirming", lastAction: "confirm" });

  const confirmButton = screen.getByRole("button", { name: /confirm proposed change/i });
  const cancelButton = screen.getByRole("button", { name: /cancel proposed change/i });

  expect(confirmButton).toBeDisabled();
  expect(cancelButton).toBeDisabled();
  expect(confirmButton).toHaveTextContent(/confirming/i);
});

// The disabled attribute (asserted above) is what actually prevents a
// duplicate confirmation through the UI - this test proves that guard
// holds end-to-end: a click against an already-busy card must not reach
// onConfirm a second time. (userEvent.click on a genuinely disabled
// button does not dispatch a click event, matching real browser behavior.)
test("PendingActionCard: clicking Confirm while already 'confirming' never calls onConfirm again", async () => {
  const user = userEvent.setup();
  const { onConfirm } = renderCard({ status: "confirming", lastAction: "confirm" });

  await user.click(screen.getByRole("button", { name: /confirm proposed change/i }));

  expect(onConfirm).not.toHaveBeenCalled();
});

test("PendingActionCard: an error state shows the safe error message and a Retry button, not Confirm/Cancel", () => {
  renderCard({ status: "error", lastAction: "confirm", error: "This proposal is no longer pending" });

  expect(screen.getByText("This proposal is no longer pending")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /confirm proposed change/i })).not.toBeInTheDocument();
});

test("PendingActionCard: clicking Retry after a failed confirm calls onConfirm again with the same action id (never onCancel)", async () => {
  const user = userEvent.setup();
  const { onConfirm, onCancel } = renderCard({
    status: "error",
    lastAction: "confirm",
    error: "Something went wrong. Please try again.",
  });

  await user.click(screen.getByRole("button", { name: /retry/i }));

  expect(onConfirm).toHaveBeenCalledWith("action-1");
  expect(onCancel).not.toHaveBeenCalled();
});
