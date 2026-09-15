"use client";

import { useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import type { Task, TaskSummary } from "@/lib/types";
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from "./task-form-fields";

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<
  TaskSummary["status"],
  string
>;
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label])) as Record<
  TaskSummary["priority"],
  string
>;

interface TaskDetailsSheetProps {
  task: TaskSummary;
  cachedTask: Task | undefined;
  trigger: ReactNode;
}

// GET /projects/:projectId/tasks only ever returns TaskSummary (see
// lib/types.ts) - there is no GET /tasks/:id endpoint to fetch the rest of
// a task on demand, and this part deliberately does not add one. So this
// view shows exactly what's actually available: the summary fields always,
// plus the fuller Task fields only when this task has been created/edited
// in this session (see useTasks's getCachedTask) - and says so plainly
// rather than pretending a summary is the full task.
export function TaskDetailsSheet({ task, cachedTask, trigger }: TaskDetailsSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="break-words">{task.title}</SheetTitle>
          <SheetDescription>Task details</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{STATUS_LABEL[task.status]}</Badge>
            <Badge variant="outline">{PRIORITY_LABEL[task.priority]}</Badge>
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground">Assignee</dt>
              <dd>{task.assigneeName ?? "Unassigned"}</dd>
            </div>

            {cachedTask ? (
              <>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {cachedTask.description || "No description."}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Due date</dt>
                  <dd>{cachedTask.dueDate ? new Date(cachedTask.dueDate).toLocaleDateString() : "None"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Last updated</dt>
                  <dd>{formatRelativeTime(cachedTask.updatedAt)}</dd>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Additional details (description, due date, last updated) aren&apos;t loaded for this
                task yet - they become available here after you create or edit it.
              </p>
            )}
          </dl>
        </div>
      </SheetContent>
    </Sheet>
  );
}
