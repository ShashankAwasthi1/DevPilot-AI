import type { ProjectRole } from "./types";

// Mirrors the server's assertRole gates exactly (server/src/services/
// project.service.ts, project-member.service.ts) - this is UI gating
// only, so a button can be hidden/disabled for a role that could never
// succeed anyway. It is NOT a security boundary: the server re-checks
// every one of these rules independently on every request, and remains
// the only authoritative enforcement point.

// OWNER + ADMIN: addProjectMember, updateProjectMemberRole,
// removeProjectMember (project-member.service.ts) all use this same
// allowed-role set - membership management is one admin-level capability,
// not several with different rules, so one helper backs all three.
function isOwnerOrAdmin(role: ProjectRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageMembers(role: ProjectRole): boolean {
  return isOwnerOrAdmin(role);
}

export function canAddMember(role: ProjectRole): boolean {
  return isOwnerOrAdmin(role);
}

export function canManageMemberRole(role: ProjectRole): boolean {
  return isOwnerOrAdmin(role);
}

export function canRemoveMember(role: ProjectRole): boolean {
  return isOwnerOrAdmin(role);
}

// OWNER + ADMIN: updateProject (project.service.ts).
export function canUpdateProject(role: ProjectRole): boolean {
  return isOwnerOrAdmin(role);
}

// OWNER only: archiveProject (project.service.ts).
export function canArchiveProject(role: ProjectRole): boolean {
  return role === "OWNER";
}
