import { Task, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { getProjectAccess, ProjectRole } from "./project.service";

export interface TaskAccess {
  task: Task;
  projectId: string;
  role: ProjectRole;
}

// A task has no access rules of its own - it is only ever reachable through
// its project's membership. This always derives the project from the task
// row itself (task.projectId), never from anything a client supplies, so a
// task id can't be paired with an unrelated projectId to bypass access.
export async function getTaskAccess(taskId: string, userId: string): Promise<TaskAccess> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  // Reuses the exact same access resolution a project-scoped request would
  // get - if the project itself would 404 for this user, so does the task.
  const { role } = await getProjectAccess(task.projectId, userId);

  return { task, projectId: task.projectId, role };
}

export interface TaskSummaryDto {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
}

// Read-only summary used by ai-context.service.ts. There is no Task-creation
// API yet, so this will return an empty list for most real projects today -
// it exists so context assembly has a genuine, authorized source instead of
// a raw query of its own.
export async function listTaskSummariesForProject(
  userId: string,
  projectId: string,
  limit: number,
): Promise<TaskSummaryDto[]> {
  await getProjectAccess(projectId, userId);

  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { assignee: { select: { name: true, email: true } } },
  });

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assigneeName: task.assignee?.name ?? task.assignee?.email ?? null,
  }));
}
