// Mirrors server/src/types/auth.ts's SafeUser. Dates arrive as ISO strings
// over JSON, never Date objects.
export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors server/src/services/project.service.ts's ProjectDto.
export type ProjectRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: ProjectRole;
}

// Mirrors server/src/services/notification.service.ts's NotificationDto.
export type NotificationType = "TASK_COMMENT_CREATED";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
}

// Mirrors server/src/services/activity.service.ts's ActivityDto.
export type ActivityType = "COMMENT_CREATED" | "DOCUMENT_CREATED" | "DOCUMENT_UPDATED" | "DOCUMENT_ARCHIVED";

export interface ActivityItem {
  id: string;
  projectId: string;
  taskId: string | null;
  actorId: string | null;
  type: ActivityType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
