import { api } from "./api";
import type { ProjectMember, ProjectRole } from "./types";

// Request-side role shape for the mutation endpoints below - deliberately
// excludes "OWNER", since the server never accepts it either (the owner is
// represented by Project.ownerId, never a stored ProjectMember row - see
// server/src/validation/project.validation.ts's addProjectMemberSchema/
// updateProjectMemberRoleSchema, both of which reject it for the same
// reason).
export type StorableProjectMemberRole = Exclude<ProjectRole, "OWNER">;

// Request-side shapes, kept here rather than in types.ts - same convention
// as lib/documents.ts's CreateDocumentInput/UpdateDocumentInput, since
// these describe what a caller may send, not a mirror of a response DTO.
export interface AddProjectMemberInput {
  email: string;
  role: StorableProjectMemberRole;
}

export interface UpdateProjectMemberRoleInput {
  role: StorableProjectMemberRole;
}

// GET /projects/:projectId/members - authorized the same way every other
// project-scoped read is (project membership); a project the caller can't
// access 404s exactly like /tasks or /activity already do.
export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`).then((result) => result.members);
}

// POST /projects/:projectId/members - adds an existing registered user to
// the project by email. Mirrors documents.ts's createDocument: server
// response is { member: ProjectMember }, unwrapped here so callers work
// directly with the member, not the envelope.
export function addProjectMember(projectId: string, input: AddProjectMemberInput): Promise<ProjectMember> {
  return api
    .post<{ member: ProjectMember }>(`/projects/${projectId}/members`, input)
    .then((result) => result.member);
}

// PATCH /projects/:projectId/members/:userId - changes an existing
// member's stored role. userId is a URL segment, never part of the body -
// the server's own schema doesn't accept it there either.
export function updateProjectMemberRole(
  projectId: string,
  userId: string,
  input: UpdateProjectMemberRoleInput,
): Promise<ProjectMember> {
  return api
    .patch<{ member: ProjectMember }>(`/projects/${projectId}/members/${userId}`, input)
    .then((result) => result.member);
}

// DELETE /projects/:projectId/members/:userId - removes an existing
// member. No request body, matching api.delete's existing signature
// (documents.ts's archiveDocument uses the same shape) - returns the
// now-removed ProjectMember, matching the server's response.
export function removeProjectMember(projectId: string, userId: string): Promise<ProjectMember> {
  return api
    .delete<{ member: ProjectMember }>(`/projects/${projectId}/members/${userId}`)
    .then((result) => result.member);
}
