import { test, expect, uniqueId } from "./fixtures";

test.describe("Project and task workflow", () => {
  test("Create a project, then create and update a task in it", async ({ authedPage: page }) => {
    const projectName = `E2E Project ${uniqueId()}`;
    const taskTitle = `E2E Task ${uniqueId()}`;

    // --- Project creation (dashboard) ---
    // Scoped to the "Your projects" region (components/dashboard/
    // projects-section.tsx's <section aria-labelledby="projects-heading">)
    // rather than the page at large, since DashboardHeader's own "Create
    // Project" button has the same accessible name and would otherwise
    // make this locator match two elements.
    const projectsRegion = page.getByRole("region", { name: "Your projects" });
    await projectsRegion.getByRole("button", { name: "Create Project", exact: true }).click();
    const createProjectDialog = page.getByRole("dialog");
    await createProjectDialog.getByLabel("Name").fill(projectName);
    await createProjectDialog.getByRole("button", { name: "Create project", exact: true }).click();

    const projectLink = page.getByRole("link", { name: projectName });
    await expect(projectLink).toBeVisible();
    await projectLink.click();
    await expect(page).toHaveURL(/\/projects\//);

    // --- Task creation (project workspace) ---
    await page.getByRole("button", { name: "Create task", exact: true }).first().click();
    const createTaskDialog = page.getByRole("dialog");
    await createTaskDialog.getByLabel("Title").fill(taskTitle);
    await createTaskDialog.getByRole("button", { name: "Create task", exact: true }).click();

    const taskRow = page.locator("li").filter({ hasText: taskTitle });
    await expect(taskRow).toBeVisible();
    // Newly-created tasks default to "To do" (see
    // components/tasks/task-form-fields.tsx's EMPTY_VALUES).
    await expect(taskRow.getByText("To do")).toBeVisible();

    // --- Task status update ---
    await taskRow.getByRole("button", { name: "Edit task" }).click();
    const editTaskDialog = page.getByRole("dialog");
    await editTaskDialog.getByLabel("Status").selectOption("IN_PROGRESS");
    await editTaskDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(taskRow.getByText("In progress")).toBeVisible();
  });
});
