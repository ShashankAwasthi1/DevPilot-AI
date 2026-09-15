import { api } from "./api";
import type { ProjectMember } from "./types";

// GET /projects/:projectId/members - authorized the same way every other
// project-scoped read is (project membership); a project the caller can't
// access 404s exactly like /tasks or /activity already do.
export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`).then((result) => result.members);
}
