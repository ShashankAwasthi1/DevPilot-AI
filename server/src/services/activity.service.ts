import { Activity, ActivityType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { getProjectAccess } from "./project.service";

export interface ActivityDto {
  id: string;
  projectId: string;
  taskId: string | null;
  actorId: string | null;
  type: ActivityType;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

function toActivityDto(activity: Activity): ActivityDto {
  return {
    id: activity.id,
    projectId: activity.projectId,
    taskId: activity.taskId,
    actorId: activity.actorId,
    type: activity.type,
    metadata: activity.metadata,
    createdAt: activity.createdAt,
  };
}

interface RecordActivityInput {
  projectId: string;
  taskId?: string;
  actorId: string;
  type: ActivityType;
  metadata: Prisma.InputJsonValue;
}

// Accepts either the regular Prisma client or an interactive-transaction
// client, so a service performing some mutation can write the activity row
// in the exact same transaction as the mutation itself.
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

// The only place an Activity row is ever created. There is no API endpoint
// that lets a client create one directly - this is called exclusively from
// other services as a side effect of something they already authorized.
export async function recordActivity(
  client: PrismaClientOrTx,
  input: RecordActivityInput,
): Promise<void> {
  await client.activity.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId,
      actorId: input.actorId,
      type: input.type,
      metadata: input.metadata,
    },
  });
}

export async function listActivityForProject(
  userId: string,
  projectId: string,
  limit?: number,
): Promise<ActivityDto[]> {
  // Any role (OWNER/ADMIN/MEMBER/VIEWER) may view activity; getProjectAccess
  // already returns 404 for a nonexistent/inaccessible project, so no
  // further role check is needed here.
  await getProjectAccess(projectId, userId);

  if (limit === undefined) {
    // Existing, unbounded behavior - unchanged for the public
    // GET /projects/:id/activity route (activity.controller.ts), which has
    // always returned the full history oldest-first.
    const activities = await prisma.activity.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });
    return activities.map(toActivityDto);
  }

  // Bounded path, added for the AI getActivity tool: fetch only the N most
  // recent rows at the database level. Ordered by createdAt + id (not
  // createdAt alone, which isn't guaranteed unique) for deterministic
  // results, matching the rest of the codebase's list-ordering convention.
  // Already newest-first - no in-memory slicing or reversing needed.
  const activities = await prisma.activity.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return activities.map(toActivityDto);
}

// Cross-project feed for the dashboard - same ownership/membership scoping
// idiom as project.service.ts's listProjectsForUser, just reached through
// the project relation instead of the Project table itself. No separate
// role check needed: a project the user has no relationship to is already
// excluded by this same OR clause.
export async function listActivityForUser(userId: string, limit: number): Promise<ActivityDto[]> {
  const activities = await prisma.activity.findMany({
    where: {
      project: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return activities.map(toActivityDto);
}
