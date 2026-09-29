import { test, expect, uniqueId, testPassword } from "./fixtures";

test.describe("Authentication", () => {
  test("Signup redirects a new user into the dashboard", async ({ page }) => {
    const email = `e2e-signup-${uniqueId()}@example.test`;
    const password = testPassword();

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(email)).toBeVisible();
  });

  test("Clearing the session cookie redirects back to /login", async ({ authedPage }) => {
    // Deterministic stand-in for real session expiry (the cookie's real
    // TTL is 7 days, see server/src/config/auth.ts): clearing the session
    // cookie and navigating exercises the exact same client-side path a
    // real 401 would (lib/api.ts's handleSessionExpired), without waiting
    // seven days or forging a fake-expired cookie.
    await authedPage.context().clearCookies();
    await authedPage.goto("/dashboard");

    await expect(authedPage).toHaveURL(/\/login/);
  });

  test("Logout returns to /login, and the dashboard is no longer reachable", async ({ authedPage }) => {
    await authedPage.getByRole("button", { name: "Sign out" }).click();
    await expect(authedPage).toHaveURL(/\/login/);

    await authedPage.goto("/dashboard");
    await expect(authedPage).toHaveURL(/\/login/);
  });
});
