import { api } from "./api";
import type { NotificationItem, NotificationListResult } from "./types";

// Query params mirror server/src/validation/notification.validation.ts's
// listNotificationsQuerySchema exactly - all optional, same names. Omitting
// every option matches the server's own default page (limit 20, both read
// and unread).
export interface ListNotificationsOptions {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
}

// GET /notifications
export function listNotifications(options: ListNotificationsOptions = {}): Promise<NotificationListResult> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.unreadOnly !== undefined) params.set("unreadOnly", String(options.unreadOnly));
  const query = params.toString();
  return api.get<NotificationListResult>(`/notifications${query ? `?${query}` : ""}`);
}

// PATCH /notifications/:id/read - returns the updated notification (with
// readAt now set), matching the server's { notification: NotificationDto }
// response.
export function markNotificationAsRead(notificationId: string): Promise<NotificationItem> {
  return api
    .patch<{ notification: NotificationItem }>(`/notifications/${notificationId}/read`)
    .then((result) => result.notification);
}

export interface MarkAllNotificationsAsReadResult {
  updatedCount: number;
}

// POST /notifications/read-all - no request body, matching the server's
// { updatedCount } response.
export function markAllNotificationsAsRead(): Promise<MarkAllNotificationsAsReadResult> {
  return api.post<MarkAllNotificationsAsReadResult>("/notifications/read-all");
}
