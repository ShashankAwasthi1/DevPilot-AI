"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Bell } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { useApiData } from "@/lib/use-api-data";
import type { NotificationListResult } from "@/lib/types";

const NOTIFICATION_LABEL: Record<string, string> = {
  TASK_COMMENT_CREATED: "New comment on a task assigned to you",
};

export function NotificationsSection() {
  const prefersReducedMotion = useReducedMotion();
  const { data, loading, error } = useApiData(
    () => api.get<NotificationListResult>("/notifications?limit=5"),
    [],
  );

  return (
    <section aria-labelledby="notifications-heading" className="flex flex-col gap-3">
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
          <AlertDescription>{error.message}</AlertDescription>
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
                      <span
                        className="size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                    {NOTIFICATION_LABEL[notification.type] ?? notification.type}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(notification.createdAt)}
                  </span>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
