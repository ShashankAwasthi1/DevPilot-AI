import { prisma } from "../config/prisma";
import { getProjectAccess, type ProjectRole } from "./project.service";

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
