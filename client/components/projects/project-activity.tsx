"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity as ActivityIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { listProjectActivity } from "@/lib/activity";
import { formatRelativeTime } from "@/lib/format";
import type { ActivityItem, ActivityType, ProjectMember } from "@/lib/types";

// Matches every ActivityType value the API can currently return (see
// server/prisma/schema.prisma's ActivityType enum and its 5 writers:
// comment.service.ts, document.service.ts, project.service.ts, and
// task.service.ts's create/update) - never invents a new type, same map
// as task-activity.tsx (kept duplicated rather than shared since each is a
// small, self-contained presentational concern, same convention this
// codebase already follows for dashboard/activity-section.tsx).
//
// The shared ActivityType in lib/types.ts still only lists the original 4
// values, so this map's key type is widened locally to the full, real set
// - activityLabel's parameter stays the narrower ActivityType so every
// existing caller is unaffected, and a value this map doesn't yet know
// about still falls back to the safe "Activity" string below.
type KnownActivityType = ActivityType | "PROJECT_CREATED" | "TASK_CREATED" | "TASK_UPDATED";

const ACTIVITY_LABEL: Record<KnownActivityType, string> = {
  COMMENT_CREATED: "Comment added",
  DOCUMENT_CREATED: "Document created",
  DOCUMENT_UPDATED: "Document updated",
  DOCUMENT_ARCHIVED: "Document archived",
  PROJECT_CREATED: "Created project",
  TASK_CREATED: "Created task",
  TASK_UPDATED: "Updated task",
};

function activityLabel(type: ActivityType): string {
  return ACTIVITY_LABEL[type] ?? "Activity";
}

function memberLabel(member: ProjectMember): string {
  return member.name || member.email;
}

// Never a second network request per activity item - resolved entirely
// from the already-fetched, project-level ProjectMember[] the page already
// has (same approach task-activity.tsx/task-comments.tsx already use).
// actorId is nullable on ActivityItem and renders as "System" rather than
// being looked up at all.
function resolveActorLabel(actorId: string | null, members: ProjectMember[], membersLoading: boolean): string {
  if (actorId === null) return "System";
  const member = members.find((m) => m.userId === actorId);
  if (member) return memberLabel(member);
  return membersLoading ? "Loading…" : "Unknown member";
}

interface ProjectActivityProps {
  projectId: string;
  members: ProjectMember[];
  membersLoading: boolean;
  membersError: ApiError | null;
  onRetryMembers: () => void;
}

// Self-contained load/retry state, same shape as task-activity.tsx's own
// TaskActivity - this is the only place in the app that needs the
// project's *entire* activity feed (task-activity.tsx filters the same
// endpoint's result down to one task; this renders it unfiltered).
export function ProjectActivity({ projectId, members, membersLoading, membersError, onRetryMembers }: ProjectActivityProps) {
  const [activities, setActivities] = useState<ActivityItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const prefersReducedMotion = useReducedMotion();
  // Bumped on every load/unmount so a stale response can never overwrite
  // state for a request that's no longer current (e.g. this component
  // remounts for a different project, or is retried more than once).
  const requestIdRef = useRef(0);

  // Only the actual fetch + its promise-chain state updates, no
  // synchronous setState of its own - lets the mount effect below call it
  // directly without tripping the "no setState directly in an effect"
  // lint rule.
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
    if (loading) return; // a request is already in flight - never fire a duplicate
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

  // The endpoint is unbounded and returns oldest-first (see lib/activity.ts)
  // - re-sorted newest-first purely client-side, never re-fetched.
  const sortedActivities = (activities ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <section aria-labelledby="project-activity-heading" className="flex flex-col gap-3">
      <h2 id="project-activity-heading" className="text-sm font-medium text-muted-foreground">
        Activity
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
          <AlertTitle>Couldn&apos;t load activity</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && sortedActivities.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <ActivityIcon className="size-6" aria-hidden="true" />
            <p>No activity yet.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && sortedActivities.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sortedActivities.map((item, index) => (
            <motion.li
              key={item.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : index * 0.04 }}
            >
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm">{activityLabel(item.type)}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{resolveActorLabel(item.actorId, members, membersLoading)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(item.createdAt)}</span>
                  </span>
                </CardContent>
              </Card>
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
