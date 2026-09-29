import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

// vi.mock(...) factories are hoisted above every import in this file, so
// they can never reference a plain top-level `const` declared below them -
// vi.hoisted() is Vitest's own escape hatch for exactly this: it runs (and
// is itself hoisted) before the mock factories that need its return value.
const { pushMock, postMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, post: postMock },
  };
});

beforeEach(() => {
  pushMock.mockReset();
  postMock.mockReset();
});

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText(/email/i), "user@example.com");
  await userEvent.type(screen.getByLabelText(/password/i), "correct-password");
}

test("LoginPage: a successful submit calls api.post once and redirects to /dashboard", async () => {
  postMock.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
  render(<LoginPage />);

  await fillCredentials();
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(postMock).toHaveBeenCalledTimes(1);
  expect(postMock).toHaveBeenCalledWith("/auth/login", {
    email: "user@example.com",
    password: "correct-password",
  });
  expect(pushMock).toHaveBeenCalledWith("/dashboard");
});

// Regression test for LoginPage's submit re-entrancy guard (Phase 25 Step
// 3A). Phase 25 Step 2's investigation found that handleSubmit had no
// `if (submitting) return` guard - unlike every other form in this app
// (signup, task create/edit, document create/edit all guard this
// explicitly). The visible <Button disabled={submitting}> only prevents a
// second *click on that element* - it does nothing against a second
// `submit` event dispatched directly on the <form> (e.g. two rapid
// Enter-key presses, or any other trigger that doesn't go through the
// button's own disabled attribute), so a guard inside handleSubmit itself
// is what's actually needed.
//
// This test dispatches two submit events back-to-back, synchronously,
// before the in-flight request resolves, and verifies that only one
// api.post call results - proving that guard is in place and effective.
// Now that Step 3A has added it, this test passes; it exists to catch a
// future regression if that guard is ever removed.
test("LoginPage: two submit events fired before the first request resolves must still only call api.post once", async () => {
  postMock.mockReturnValue(new Promise(() => {})); // never resolves - simulates "still in flight"
  render(<LoginPage />);

  await fillCredentials();

  const form = screen.getByRole("button", { name: /sign in/i }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(postMock).toHaveBeenCalledTimes(1);
});

test("LoginPage: a failed submit shows the server's error message and does not redirect", async () => {
  const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  postMock.mockRejectedValue(new ApiError(401, "Invalid email or password"));
  render(<LoginPage />);

  await fillCredentials();
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  expect(pushMock).not.toHaveBeenCalled();
});
