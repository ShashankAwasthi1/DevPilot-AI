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

// Mirrors server/src/services/conversation.service.ts's ConversationDto.
export interface ConversationSummary {
  id: string;
  projectId: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors server/src/services/message.service.ts's MessageDto.
export type ChatMessageRole = "USER" | "ASSISTANT";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
}

// Mirrors server/src/prisma/schema.prisma's TaskStatus/TaskPriority enums
// exactly (also re-declared as Zod enums in
// server/src/validation/task.validation.ts).
export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

// Mirrors server/src/services/task.service.ts's TaskDto - the full shape
// returned by POST/PATCH /projects/:projectId/tasks and /tasks/:id.
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors server/src/services/task.service.ts's TaskSummaryDto - the
// smaller shape returned by GET /projects/:projectId/tasks
// (listTaskSummariesForProject). Deliberately not the same shape as Task:
// the list endpoint reuses the existing read-only summary the AI's
// getTasks tool already relies on, rather than a second, fuller listing
// implementation - so description/assigneeId/createdById/dueDate/
// createdAt/updatedAt/projectId are not available from the list response
// today, only from a single task's create/update response.
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
}
