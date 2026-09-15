import { Task, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { assertRole, getProjectAccess, ProjectRole } from "./project.service";
import type { CreateTaskInput, UpdateTaskInput } from "../validation/task.validation";

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

export interface TaskDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toTaskDto(task: Task): TaskDto {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    createdById: task.createdById,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

// The validation layer hands dueDate through as an ISO string, null, or
// undefined - this is the one place that turns a supplied string into a
// Date for Prisma, while passing null/undefined through unchanged so
// "clear it" (null) and "leave it alone" (undefined, only meaningful for
// update - Prisma omits undefined fields from a write) both survive
// intact.
function toDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return new Date(value);
}

// A task's assignee must be someone who can actually see the project - the
// project's owner (who has no ProjectMember row of their own, same as
// project.service.ts's computeRole) or anyone with a membership row for
// this exact project. Never trusts the caller's own role/membership as a
// proxy for the assignee's - always re-checked against the assignee id
// itself, so a task can never be handed to an arbitrary user outside the
// project.
async function assertAssigneeIsProjectMember(projectId: string, assigneeId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (project?.ownerId === assigneeId) {
    return;
  }

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  });

  if (!membership) {
    throw new AppError(400, "assigneeId must be a member of this project");
  }
}

// Phase 16 Step 9 - creating a task. projectId/createdById are never taken
// from `input` (createTaskSchema doesn't even declare those fields) -
// projectId is the caller-supplied route argument (already authorized via
// getProjectAccess) and createdById is always the authenticated userId.
// No Activity row is written here: ActivityType has no task-created
// variant yet, and adding one would require a schema/migration change
// that's explicitly out of scope for this part.
export async function createTask(
  userId: string,
  projectId: string,
  input: CreateTaskInput,
): Promise<TaskDto> {
  const { role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  if (input.assigneeId) {
    await assertAssigneeIsProjectMember(projectId, input.assigneeId);
  }

  const task = await prisma.task.create({
    data: {
      projectId,
      createdById: userId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId,
      dueDate: toDueDate(input.dueDate),
    },
  });

  return toTaskDto(task);
}

// Phase 16 Step 9 - updating a task. getTaskAccess resolves the task (and
// its project's role for this user) first, and only its resolved
// `task.id`/`projectId` are ever used below - never anything the caller
// passed directly. Fields absent from `input` are `undefined`, which
// Prisma's `update` treats as "not part of this write" rather than
// writing `undefined` - so an omitted field is genuinely left unchanged,
// while an explicit `null` on description/assigneeId/dueDate still comes
// through and clears that field. `data` never includes `projectId` or
// `createdById` - neither is ever writable through this function.
export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskDto> {
  const { task, projectId, role } = await getTaskAccess(taskId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  if (input.assigneeId) {
    await assertAssigneeIsProjectMember(projectId, input.assigneeId);
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId,
      dueDate: toDueDate(input.dueDate),
    },
  });

  return toTaskDto(updated);
}

// Phase 16 Step 9 - deleting a task. Same authorization boundary as
// updateTask. A genuine hard delete - Task has no soft-delete field.
// Comment rows cascade via Comment -> Task's onDelete: Cascade, and
// Activity rows have their taskId set to null via Activity -> Task's
// onDelete: SetNull - both handled entirely by the existing schema
// relations, so this function never touches either table itself.
export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const { task, role } = await getTaskAccess(taskId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  await prisma.task.delete({
    where: { id: task.id },
  });
}
