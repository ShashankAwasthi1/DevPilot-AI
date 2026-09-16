"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bell } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { listNotifications, markAllNotificationsAsRead, markNotificationAsRead } from "@/lib/notifications";
import type { NotificationListResult } from "@/lib/types";

const NOTIFICATION_LABEL: Record<string, string> = {
  TASK_COMMENT_CREATED: "New comment on a task assigned to you",
  TASK_ASSIGNED: "You were assigned a task",
};

function toSafeMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

export function NotificationsSection() {
  const prefersReducedMotion = useReducedMotion();
  const [data, setData] = useState<NotificationListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // Which notification ids currently have a mark-as-read request in
  // flight - checked before starting a new one for the same id, so a
  // double-click can never fire two requests for the same notification.
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Bumped on every load/unmount so a stale response can never overwrite
  // state for a request that's no longer current - same pattern
  // task-comments.tsx/task-activity.tsx already use.
  const requestIdRef = useRef(0);

  // Only the actual fetch + its promise-chain state updates, no
  // synchronous setState of its own - lets the mount effect below call it
  // directly without tripping the "no setState directly in an effect"
  // lint rule.
  function fetchNotifications(requestId: number) {
    listNotifications({ limit: 5 })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong."));
        setLoading(false);
      });
  }

  function load() {
    const requestId = ++requestIdRef.current;
    setError(null);
    setLoading(true);
    fetchNotifications(requestId);
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    fetchNotifications(requestId);
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  function handleMarkAsRead(notificationId: string) {
    if (markingIds.has(notificationId)) return; // already in flight for this id

    setActionError(null);
    setMarkingIds((prev) => new Set(prev).add(notificationId));

    markNotificationAsRead(notificationId)
      .then((updated) => {
        // Reflects the real server response (the notification with readAt
        // now set) - never inserted optimistically before the request
        // resolves.
        setData((prev) => {
          if (!prev) return prev;
          const wasUnread = prev.notifications.find((n) => n.id === notificationId)?.readAt == null;
          return {
            ...prev,
            notifications: prev.notifications.map((n) => (n.id === notificationId ? updated : n)),
            unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
          };
        });
      })
      .catch((err: unknown) => {
        setActionError(toSafeMessage(err));
      })
      .finally(() => {
        setMarkingIds((prev) => {
          const next = new Set(prev);
          next.delete(notificationId);
          return next;
        });
      });
  }

  function handleMarkAllAsRead() {
    if (markingAll) return; // already in flight

    setActionError(null);
    setMarkingAll(true);

    markAllNotificationsAsRead()
      .then(() => {
        const now = new Date().toISOString();
        setData((prev) =>
          prev
            ? {
                ...prev,
                notifications: prev.notifications.map((n) => (n.readAt ? n : { ...n, readAt: now })),
                unreadCount: 0,
              }
            : prev,
        );
      })
      .catch((err: unknown) => {
        setActionError(toSafeMessage(err));
      })
      .finally(() => setMarkingAll(false));
  }

  return (
    <section aria-labelledby="notifications-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="notifications-heading" className="text-sm font-medium text-muted-foreground">
            Notifications
          </h2>
          {!loading && !error && data && data.unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {data.unreadCount} unread
            </span>
          )}
        </div>
        {!loading && !error && data && data.unreadCount > 0 && (
          <Button type="button" variant="ghost" size="xs" onClick={handleMarkAllAsRead} disabled={markingAll}>
            {markingAll ? "Marking all as read…" : "Mark all as read"}
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load notifications</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && data && data.notifications.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <Bell className="size-6" aria-hidden="true" />
            <p>You&apos;re all caught up.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.notifications.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.notifications.map((notification, index) => (
            <motion.li
              key={notification.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : index * 0.04 }}
            >
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <span className="flex items-center gap-2 text-sm">
                    {!notification.readAt && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    )}
                    {NOTIFICATION_LABEL[notification.type] ?? notification.type}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</span>
                    {!notification.readAt && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => handleMarkAsRead(notification.id)}
                        disabled={markingIds.has(notification.id)}
                        aria-label="Mark this notification as read"
                      >
                        {markingIds.has(notification.id) ? "Marking…" : "Mark as read"}
                      </Button>
                    )}
                  </span>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}
    </section>
  );
}
