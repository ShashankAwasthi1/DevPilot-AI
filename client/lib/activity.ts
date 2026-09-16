import { api } from "./api";
import type { ActivityItem } from "./types";

// GET /projects/:id/activity - returns every activity record for the
// project, oldest first (unbounded, no pagination yet - see
// server/src/routes/project.routes.ts). Callers that only care about one
// task (see task-activity.tsx) filter/reorder client-side rather than this
// helper inventing a task-scoped endpoint that doesn't exist.
export function listProjectActivity(projectId: string): Promise<ActivityItem[]> {
  return api.get<{ activity: ActivityItem[] }>(`/projects/${projectId}/activity`).then((result) => result.activity);
}
