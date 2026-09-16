"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { listProjectActivity } from "@/lib/activity";
import { formatRelativeTime } from "@/lib/format";
import type { ActivityItem, ActivityType, ProjectMember } from "@/lib/types";

// Matches the currently supported ActivityType values exactly (see
// server/src/services/comment.service.ts and document.service.ts, the only
// two places any activity record is created) - never invents a new type,
// and any future type this map doesn't know about falls back safely below
// rather than crashing or leaking a raw enum name.
const ACTIVITY_LABEL: Record<ActivityType, string> = {
  COMMENT_CREATED: "Comment added",
  DOCUMENT_CREATED: "Document created",
  DOCUMENT_UPDATED: "Document updated",
  DOCUMENT_ARCHIVED: "Document archived",
};

function activityLabel(type: ActivityType): string {
  return ACTIVITY_LABEL[type] ?? "Activity";
}

function memberLabel(member: ProjectMember): string {
  return member.name || member.email;
}

// Never a second network request per activity item - resolved entirely
// from the already-fetched, project-level ProjectMember[], same approach
// task-comments.tsx already uses for comment authors. actorId is nullable
// on ActivityItem (a small number of activity types may not have one) and
// renders as "System" rather than being looked up at all.
function resolveActorLabel(actorId: string | null, members: ProjectMember[], membersLoading: boolean): string {
  if (actorId === null) return "System";
  const member = members.find((m) => m.userId === actorId);
  if (member) return memberLabel(member);
  return membersLoading ? "Loading…" : "Unknown member";
}

interface TaskActivityProps {
  projectId: string;
  taskId: string;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Self-contained load/retry state, same shape as task-comments.tsx's own
// TaskComments - this is the only place in the app that needs a task's
// activity feed, so a shared hook isn't warranted.
export function TaskActivity({ projectId, taskId, members, membersLoading, membersError, onRetryMembers }: TaskActivityProps) {
  const [activities, setActivities] = useState<ActivityItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const prefersReducedMotion = useReducedMotion();
  // Bumped on every load/unmount so a stale response can never overwrite
  // state for a request that's no longer current.
  const requestIdRef = useRef(0);

  // Only the actual fetch + its promise-chain state updates, no
  // synchronous setState of its own - lets the mount effect below call it
  // directly without tripping the "no setState directly in an effect"
  // lint rule. load() adds the synchronous "reset to loading" step a later
  // Retry click needs, which the initial mount doesn't (loading/error
  // already start at true/null).
  function fetchActivity(requestId: number) {
    listProjectActivity(projectId)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setActivities(result);
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
    fetchActivity(requestId);
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    fetchActivity(requestId);
    return () => {
      requestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // The project activity endpoint is unbounded and returns oldest-first
  // (see lib/activity.ts) - this task's own slice is filtered and
  // re-sorted newest-first purely client-side, never re-fetched per task.
  const taskActivities = (activities ?? [])
    .filter((item) => item.taskId === taskId)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <section aria-labelledby="task-activity-heading" className="flex flex-col gap-3">
      <h3 id="task-activity-heading" className="text-xs font-medium text-muted-foreground">
        Activity
      </h3>

      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load activity</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && taskActivities.length === 0 && (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}

      {!loading && !error && taskActivities.length > 0 && (
        <ul className="flex flex-col">
          {taskActivities.map((item, index) => (
            <motion.li
              key={item.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: prefersReducedMotion ? 0 : index * 0.03 }}
              className="flex gap-2.5"
            >
              {/* Decorative timeline rail - the dot + connecting line carry
                  no information of their own (order is already conveyed by
                  list order and the visible timestamp), so both are
                  aria-hidden. */}
              <div className="flex flex-col items-center" aria-hidden="true">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                {index < taskActivities.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="flex flex-col gap-0.5 pb-3">
                <span className="text-sm">{activityLabel(item.type)}</span>
                <span className="text-xs text-muted-foreground">
                  {resolveActorLabel(item.actorId, members, membersLoading)} · {formatRelativeTime(item.createdAt)}
                </span>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {membersError && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Member names may be unavailable.</p>
          <Button type="button" variant="ghost" size="xs" onClick={onRetryMembers}>
            Retry
          </Button>
        </div>
      )}
    </section>
  );
}
