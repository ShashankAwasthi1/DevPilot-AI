import { ActivityType } from "@prisma/client";
import { AI_LIMITS } from "../ai/limits";
import { listActivityForProject } from "./activity.service";
import { listDocumentsForProject } from "./document.service";
import { getProjectForUser } from "./project.service";
import { listTaskSummariesForProject, TaskSummaryDto } from "./task.service";

// Orchestration/formatting only: every fact here comes from an existing,
// already-authorized service function (getProjectForUser,
// listDocumentsForProject, listTaskSummariesForProject,
// listActivityForProject). This file must never call `prisma` directly or
// re-implement an access check - if a new kind of context is ever needed,
// it should be read through its own service's access-checked function, not
// added here as a raw query.
export interface ProjectContext {
  projectName: string;
  projectDescription: string | null;
  documents: { title: string; content: string }[];
  tasks: TaskSummaryDto[];
  activity: string[];
}

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  COMMENT_CREATED: "A comment was added to a task",
  DOCUMENT_CREATED: "A document was created",
  DOCUMENT_UPDATED: "A document was updated",
  DOCUMENT_ARCHIVED: "A document was archived",
};

export async function buildProjectContext(
  userId: string,
  projectId: string,
): Promise<ProjectContext> {
  // getProjectForUser re-derives access itself (via getProjectAccess) -
  // deliberately not skipped even though the caller already checked access
  // moments earlier, since this is the only place project name/description
  // are read from.
  const [project, documentsResult, tasks, activity] = await Promise.all([
    getProjectForUser(userId, projectId),
    listDocumentsForProject(userId, projectId, { limit: AI_LIMITS.MAX_CONTEXT_DOCUMENTS }),
    listTaskSummariesForProject(userId, projectId, AI_LIMITS.MAX_TASKS),
    listActivityForProject(userId, projectId),
  ]);

  return {
    projectName: project.name,
    projectDescription: project.description,
    documents: documentsResult.documents.map((doc) => ({
      title: doc.title,
      content: doc.content.slice(0, AI_LIMITS.MAX_DOCUMENT_CHARS_EACH),
    })),
    tasks,
    // listActivityForProject returns ascending (oldest first) with no
    // limit - take the most recent N, then present newest-first.
    activity: activity
      .slice(-AI_LIMITS.MAX_ACTIVITY_ITEMS)
      .reverse()
      .map((item) => `${ACTIVITY_LABEL[item.type]} (${item.createdAt.toISOString()})`),
  };
}
