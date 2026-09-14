"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Activity as ActivityIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { useApiData } from "@/lib/use-api-data";
import type { ActivityItem } from "@/lib/types";

const ACTIVITY_LABEL: Record<string, string> = {
  COMMENT_CREATED: "commented on a task",
  DOCUMENT_CREATED: "created a document",
  DOCUMENT_UPDATED: "updated a document",
  DOCUMENT_ARCHIVED: "archived a document",
};

export function ActivitySection() {
  const prefersReducedMotion = useReducedMotion();
  const { data, loading, error } = useApiData(
    () => api.get<{ activity: ActivityItem[] }>("/dashboard/activity"),
    [],
  );

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-sm font-medium text-muted-foreground">
        Recent activity
      </h2>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load recent activity</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && data && data.activity.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <ActivityIcon className="size-6" aria-hidden="true" />
            <p>No activity across your projects yet.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.activity.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.activity.map((item, index) => (
            <motion.li
              key={item.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : index * 0.04 }}
            >
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm">{ACTIVITY_LABEL[item.type] ?? item.type}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(item.createdAt)}
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
