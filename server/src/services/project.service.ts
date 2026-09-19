import { Project, ProjectMemberRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { recordActivity } from "./activity.service";
import type { CreateProjectInput, UpdateProjectInput } from "../validation/project.validation";

export type ProjectRole = "OWNER" | ProjectMemberRole;

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  role: ProjectRole;
}

interface ProjectWithCallerMembership extends Project {
  members: { role: ProjectMemberRole }[];
}

function toProjectDto(project: Project, role: ProjectRole): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    ownerId: project.ownerId,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    role,
  };
}

// Owner always has full access, independent of any ProjectMember row -
// Phase 06 deliberately does not create one for the owner (see BLUEPRINT
// discussion). Anyone else's access is whatever their membership row says.
function computeRole(project: ProjectWithCallerMembership, userId: string): ProjectRole | null {
  if (project.ownerId === userId) {
    return "OWNER";
  }
  return project.members[0]?.role ?? null;
}

export function assertRole(role: ProjectRole, allowed: ProjectRole[]): void {
  if (!allowed.includes(role)) {
    throw new AppError(403, "You do not have permission to perform this action");
  }
}

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

// The single place that decides "can this user touch this project, and as
// what role". Every read/write below goes through this - never a bare
// findUnique/update by id alone - so access control can't be bypassed by
// forgetting a check in some new handler later. Exported so other entities
// that hang off a project (tasks, comments, activity) reuse this instead of
// re-implementing project-access resolution.
export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { where: { userId }, select: { role: true } } },
  });

  if (!project) {
    throw new AppError(404, "Project not found");
  }

  const role = computeRole(project, userId);

  if (!role) {
    // Exists, but this user has no relationship to it - respond exactly
    // like "not found" so a project id can't be used to probe existence.
    throw new AppError(404, "Project not found");
  }

  return { project, role };
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const project = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      ownerId: userId,
    },
  });

  await recordActivity(prisma, {
    projectId: project.id,
    actorId: userId,
    type: "PROJECT_CREATED",
    metadata: { projectId: project.id, actorId: userId },
  });

  return toProjectDto(project, "OWNER");
}

export async function listProjectsForUser(
  userId: string,
  includeArchived: boolean,
): Promise<ProjectDto[]> {
  const projects = await prisma.project.findMany({
    where: {
      ...(includeArchived ? {} : { archivedAt: null }),
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: { members: { where: { userId }, select: { role: true } } },
    orderBy: { createdAt: "desc" },
  });

  return projects.map((project) => {
    // The WHERE clause above guarantees every row here is either owned by
    // userId or has a membership row for them, so this can never be null.
    const role = computeRole(project, userId)!;
    return toProjectDto(project, role);
  });
}

export async function getProjectForUser(userId: string, projectId: string): Promise<ProjectDto> {
  const { project, role } = await getProjectAccess(projectId, userId);
  return toProjectDto(project, role);
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  const { role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN"]);

  const project = await prisma.project.update({
    where: { id: projectId },
    data: input,
  });

  return toProjectDto(project, role);
}

export async function archiveProject(userId: string, projectId: string): Promise<ProjectDto> {
  const { project, role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER"]);

  if (project.archivedAt) {
    // Archiving an already-archived project is a no-op success, not an
    // error - DELETE should be idempotent.
    return toProjectDto(project, role);
  }

  const archived = await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date() },
  });

  return toProjectDto(archived, role);
}
