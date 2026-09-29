import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectWorkspacePage from "./page";
import type { SafeUser } from "@/lib/types";

// vi.mock(...) factories are hoisted above every import in this file -
// vi.hoisted() lets the mock factories reference these without a
// "Cannot access before initialization" error (same pattern already used
// in app/login/page.test.tsx).
const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "missing-or-inaccessible-project-id" }),
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

const USER: SafeUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      // Real backend behavior for both "project doesn't exist" and "not a
      // member of this project": an identical 404, never distinguishing
      // the two. This test only needs GET /auth/me (resolves) and GET
      // /projects/:id (rejects) - any other path this page's hooks
      // happen to call (tasks/members/activity) also rejects, which is
      // fine since none of that UI renders once the project itself is
      // unavailable.
      get: vi.fn(async (path: string) => {
        if (path === "/auth/me") return { user: USER };
        throw new actual.ApiError(404, "Not found");
      }),
    },
  };
});

test("ProjectWorkspacePage: an invalid/inaccessible project id shows a 'Project not found' state, not the task workspace", async () => {
  render(<ProjectWorkspacePage />);

  expect(await screen.findByText("Project not found")).toBeInTheDocument();

  const dashboardLink = screen.getByRole("link", { name: /go to dashboard/i });
  expect(dashboardLink).toHaveAttribute("href", "/dashboard");

  // None of the project-specific workspace chrome should render once the
  // project itself couldn't be loaded.
  expect(screen.queryByRole("link", { name: /docs/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /members/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /open chat/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /tasks/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /new task/i })).not.toBeInTheDocument();
});
