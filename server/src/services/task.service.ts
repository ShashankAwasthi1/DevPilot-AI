import { Task } from "@prisma/client";
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
