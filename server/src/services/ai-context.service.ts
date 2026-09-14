import { getProjectForUser } from "./project.service";

// Phase 13 evolution of Phase 12's context assembly: the system prompt now
// carries only minimal, always-relevant project framing. Documents, tasks,
// and activity are no longer eagerly stuffed into every message - they are
// retrieved on demand through the getDocuments/getTasks/getActivity tools
// (see ai/tools/) instead, so the model only pulls in what a given question
// actually needs.
//
// Still orchestration/formatting only: the one fact here comes from an
// existing, already-authorized service function (getProjectForUser). This
// file must never call `prisma` directly or re-implement an access check.
export interface ProjectContext {
  projectName: string;
  projectDescription: string | null;
}

export async function buildProjectContext(
  userId: string,
  projectId: string,
): Promise<ProjectContext> {
  const project = await getProjectForUser(userId, projectId);
  return {
    projectName: project.name,
    projectDescription: project.description,
  };
}
