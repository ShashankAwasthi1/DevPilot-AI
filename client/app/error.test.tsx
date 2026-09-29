import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorPage from "./error";

// A deliberately distinctive, never-shown message/stack, so a test failure
// here would look exactly like "the raw error leaked" rather than an
// ambiguous string collision with the page's own copy.
function makeSensitiveError(): Error & { digest?: string } {
  const err = new Error("RAW_INTERNAL_DETAIL_secret-column-name") as Error & { digest?: string };
  err.stack = "Error: RAW_INTERNAL_DETAIL_secret-column-name\n    at STACK_TRACE_MARKER";
  err.digest = "DIGEST_MARKER_1234";
  return err;
}

test("ErrorPage: shows a clear, user-friendly 'Something went wrong' message", () => {
  render(<ErrorPage error={makeSensitiveError()} reset={() => {}} />);

  // CardTitle (shadcn) renders as a styled <div>, not a native heading
  // element - queried by visible text here rather than an ARIA heading
  // role, since there genuinely isn't one in the rendered markup.
  expect(screen.getByText("Something went wrong")).toBeInTheDocument();
});

test("ErrorPage: the Try again button calls reset()", async () => {
  const user = userEvent.setup();
  const reset = vi.fn();

  render(<ErrorPage error={makeSensitiveError()} reset={reset} />);
  await user.click(screen.getByRole("button", { name: /try again/i }));

  expect(reset).toHaveBeenCalledTimes(1);
});

test("ErrorPage: the Go to Dashboard action links to /dashboard", () => {
  render(<ErrorPage error={makeSensitiveError()} reset={() => {}} />);

  const link = screen.getByRole("link", { name: /go to dashboard/i });
  expect(link).toHaveAttribute("href", "/dashboard");
});

test("ErrorPage: never renders the error's message, stack, or digest", () => {
  render(<ErrorPage error={makeSensitiveError()} reset={() => {}} />);

  const rendered = document.body.textContent ?? "";
  expect(rendered).not.toContain("RAW_INTERNAL_DETAIL_secret-column-name");
  expect(rendered).not.toContain("STACK_TRACE_MARKER");
  expect(rendered).not.toContain("DIGEST_MARKER_1234");
});
