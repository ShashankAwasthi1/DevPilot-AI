import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { assertRole, getProjectAccess, type ProjectRole } from "./project.service";
import type { AddProjectMemberInput, UpdateProjectMemberRoleInput } from "../validation/project.validation";

export interface ProjectMemberDto {
  userId: string;
  name: string | null;
  email: string;
  role: ProjectRole;
}

// Phase 16 Step 9 Part 10 - listing a project's members, for the frontend
// assignee picker. Authorization is the exact same getProjectAccess
// boundary every other project-scoped read already uses (activity, tasks,
// documents) - a caller with no relationship to the project gets the
// existing 404 ("Project not found"), never a list of members, and never
// a distinguishable error from "project doesn't exist".
//
// The project's owner is deliberately included even though (per
// project.service.ts's computeRole) they have no ProjectMember row of
// their own - the assignee picker must be able to offer the owner as a
// valid assignee, matching task.service.ts's own
// assertAssigneeIsProjectMember, which already treats the owner as a
// legitimate assignee.
export async function listProjectMembers(userId: string, projectId: string): Promise<ProjectMemberDto[]> {
  const { project } = await getProjectAccess(projectId, userId);

  const [owner, memberRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: project.ownerId },
      select: { id: true, name: true, email: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const members: ProjectMemberDto[] = [];

  if (owner) {
    members.push({ userId: owner.id, name: owner.name, email: owner.email, role: "OWNER" });
  }

  for (const member of memberRows) {
    members.push({
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
    });
  }

  return members;
}

// Adding an existing registered user to a project by email. Only OWNER/ADMIN
// may do this - the same gate updateProject already uses (project.service.ts),
// since membership management is an admin-level project setting, not
// something every member can do. "OWNER" is never an accepted stored role
// here - see addProjectMemberSchema's own comment - so the created row's
// role is always ADMIN/MEMBER/VIEWER, matching ProjectMemberRole exactly.
export async function addProjectMember(
  userId: string,
  projectId: string,
  input: AddProjectMemberInput,
): Promise<ProjectMemberDto> {
  const { project, role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN"]);

  const targetUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    // Same "don't reveal more than necessary" posture as getProjectAccess's
    // own 404s - a caller who can already manage this project's membership
    // learns only that this email has no matching account, never anything
    // about other projects/users beyond that.
    throw new AppError(404, "User not found");
  }

  if (targetUser.id === project.ownerId) {
    // The owner is represented by Project.ownerId, never a ProjectMember
    // row (see project.service.ts's computeRole) - creating one for them
    // would be a second, contradictory source of truth for their role.
    throw new AppError(409, "This user is already the project owner");
  }

  // Checked explicitly (rather than only relying on the @@unique([projectId,
  // userId]) constraint, see schema.prisma) so a duplicate add gets this
  // specific, readable message instead of a raw Prisma P2002 error - the
  // unique constraint remains the safety net for a concurrent duplicate
  // request.
  const existingMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: targetUser.id } },
  });

  if (existingMembership) {
    throw new AppError(409, "This user is already a project member");
  }

  const created = await prisma.projectMember.create({
    data: { projectId, userId: targetUser.id, role: input.role },
  });

  return { userId: targetUser.id, name: targetUser.name, email: targetUser.email, role: created.role };
}

// Changing an existing member's stored role. Same OWNER/ADMIN gate as
// addProjectMember - membership management (who's on the project, and as
// what role) is one admin-level capability, not several with different
// rules. Deliberately does NOT add any extra restriction on an ADMIN
// changing another ADMIN's role (or their own): this codebase's RBAC model
// is "does the caller's role appear in the allowed list for this action"
// (assertRole), never a target-relative/hierarchical check, and
// updateProject's own OWNER/ADMIN gate has no such extra restriction
// either - introducing one here would be a new, one-off permission
// concept instead of reusing the existing model.
export async function updateProjectMemberRole(
  userId: string,
  projectId: string,
  targetUserId: string,
  input: UpdateProjectMemberRoleInput,
): Promise<ProjectMemberDto> {
  const { project, role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN"]);

  if (targetUserId === project.ownerId) {
    // The owner's role is Project.ownerId, not a ProjectMember row (see
    // project.service.ts's computeRole) - there is no row here to change,
    // and creating one would be a second, contradictory source of truth.
    throw new AppError(409, "The project owner's role cannot be changed");
  }

  const existingMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!existingMembership) {
    throw new AppError(404, "Project member not found");
  }

  const updated = await prisma.projectMember.update({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    data: { role: input.role },
  });

  return {
    userId: existingMembership.user.id,
    name: existingMembership.user.name,
    email: existingMembership.user.email,
    role: updated.role,
  };
}

// Removing an existing member from a project. Same OWNER/ADMIN gate and
// same "no target-relative restriction" rule as updateProjectMemberRole
// (an ADMIN may remove another ADMIN) - removing someone is not a more
// sensitive action than changing their role, so there is no reason for it
// to follow a different RBAC rule.
export async function removeProjectMember(
  userId: string,
  projectId: string,
  targetUserId: string,
): Promise<ProjectMemberDto> {
  const { project, role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN"]);

  if (targetUserId === project.ownerId) {
    // The owner has no ProjectMember row to delete (see
    // project.service.ts's computeRole) - "removing" them from the
    // project isn't a membership operation this endpoint can perform.
    throw new AppError(409, "The project owner cannot be removed");
  }

  const existingMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!existingMembership) {
    throw new AppError(404, "Project member not found");
  }

  // Deletes only this specific (projectId, userId) membership row - never
  // the User itself, the Project itself, or any of this user's other
  // project memberships, which is exactly what deleting by the compound
  // unique key guarantees.
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  });

  return {
    userId: existingMembership.user.id,
    name: existingMembership.user.name,
    email: existingMembership.user.email,
    role: existingMembership.role,
  };
}
