import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivitySection } from "./activity-section";

// vi.mock(...) factories are hoisted above every import in this file -
// vi.hoisted() lets the mock factory reference this without a "Cannot
// access before initialization" error (same pattern used in
// app/login/page.test.tsx and app/projects/[id]/page.test.tsx).
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: getMock },
  };
});

beforeEach(() => {
  getMock.mockReset();
});

test("ActivitySection: a successful load with items renders them, with no Retry button", async () => {
  getMock.mockResolvedValue({
    activity: [
      { id: "a1", type: "TASK_CREATED", projectName: "Launch", createdAt: new Date().toISOString() },
    ],
  });

  render(<ActivitySection />);

  expect(await screen.findByText("launch")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
});

test("ActivitySection: an empty result renders the empty state, with no Retry button", async () => {
  getMock.mockResolvedValue({ activity: [] });

  render(<ActivitySection />);

  expect(await screen.findByText("No activity across your projects yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
});

test("ActivitySection: a failed load shows the error message and a Retry button", async () => {
  const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  getMock.mockRejectedValue(new ApiError(500, "Something went wrong."));

  render(<ActivitySection />);

  expect(await screen.findByText("Couldn't load recent activity")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  expect(getMock).toHaveBeenCalledTimes(1);
});

test("ActivitySection: clicking Retry re-triggers the activity request, and a subsequent success replaces the error state", async () => {
  const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  getMock.mockRejectedValueOnce(new ApiError(500, "Something went wrong."));
  getMock.mockResolvedValueOnce({
    activity: [
      { id: "a1", type: "TASK_CREATED", projectName: "Launch", createdAt: new Date().toISOString() },
    ],
  });

  const user = userEvent.setup();
  render(<ActivitySection />);

  const retryButton = await screen.findByRole("button", { name: /retry/i });
  await user.click(retryButton);

  await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("launch")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load recent activity")).not.toBeInTheDocument();
});
