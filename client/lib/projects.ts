import { api } from "./api";
import type { ProjectSummary } from "./types";

// Request-side shape, kept here rather than in types.ts - same convention
// as lib/documents.ts's UpdateDocumentInput, since this describes what a
// caller may send, not a mirror of the ProjectDto response. Mirrors
// server/src/validation/project.validation.ts's updateProjectSchema; the
// server itself requires at least one field to be present, enforced there,
// not duplicated here.
export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

// PATCH /projects/:projectId - updates name/description. Server response
// is { project: ProjectSummary } (the same ProjectDto shape returned by
// every other project endpoint, ProjectSummary here is the client's
// existing name for it - see lib/types.ts), unwrapped here so callers work
// directly with the project, not the envelope.
export function updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectSummary> {
  return api
    .patch<{ project: ProjectSummary }>(`/projects/${projectId}`, input)
    .then((result) => result.project);
}

// DELETE /projects/:projectId - archives the project (soft archive, not a
// hard delete - see server/src/services/project.service.ts's
// archiveProject). No request body, matching api.delete's existing
// signature (documents.ts's archiveDocument uses the same shape) -
// returns the now-archived ProjectSummary, matching the server's response.
export function archiveProject(projectId: string): Promise<ProjectSummary> {
  return api.delete<{ project: ProjectSummary }>(`/projects/${projectId}`).then((result) => result.project);
}
