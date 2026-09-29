import { test as base, expect, type Page } from "@playwright/test";

// A short, collision-resistant suffix for test data (emails, project/task
// names) - unique enough per run/worker without needing a UUID dependency.
export function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Meets server/src/validation/auth.validation.ts's signupSchema bound
// (8-72 chars) with no ambiguity against any of this suite's own text
// assertions.
export function testPassword(): string {
  return "E2e-test-password-1!";
}

interface WorkerFixtures {
  sharedAccount: { email: string; password: string };
}

interface TestFixtures {
  authedPage: Page;
}

// One real signup per worker, not one per test - the backend's real
// signup limiter allows only 5 signups / 15 minutes / IP
// (server/src/middleware/rate-limit.ts), and this suite runs with a
// single worker (see playwright.config.ts), so this fires exactly once
// per full local run. Every test that just needs to be signed in as
// *some* real user (session expiry, project/task, logout) logs into this
// one shared account fresh (via authedPage below) rather than signing up
// its own - auth.spec.ts's own signup test creates a separate, dedicated
// account instead, since it exists specifically to exercise that flow.
export const test = base.extend<TestFixtures, WorkerFixtures>({
  sharedAccount: [
    async ({ browser }, use, workerInfo) => {
      const email = `e2e-shared-w${workerInfo.workerIndex}-${uniqueId()}@example.test`;
      const password = testPassword();

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/signup");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await context.close();

      await use({ email, password });
    },
    { scope: "worker" },
  ],

  // A fresh, isolated browser context/session per test, logged in as the
  // shared account - so no test's session manipulation (the session-
  // expiry test clearing cookies, the logout test signing out) can ever
  // leak into another test.
  authedPage: async ({ browser, sharedAccount }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(sharedAccount.email);
    await page.getByLabel("Password").fill(sharedAccount.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await use(page);
    await context.close();
  },
});

export { expect };
