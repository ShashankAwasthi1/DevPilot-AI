"use client";

import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";

export type TaskView = "list" | "kanban";

interface TaskViewToggleProps {
  view: TaskView;
  onViewChange: (view: TaskView) => void;
}

// Same toggle-button-group pattern as components/chat/mode-toggle.tsx
// (aria-pressed rather than the ARIA tabs pattern, since there's no
// separate tabpanel semantics here either - just which presentation
// renders the same already-filtered/sorted task collection). Client-side
// UI state only, owned by task-list.tsx - never persisted, never a URL
// param.
export function TaskViewToggle({ view, onViewChange }: TaskViewToggleProps) {
  return (
    <div role="group" aria-label="Task view" className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
      <Button
        type="button"
        size="xs"
        variant={view === "list" ? "default" : "ghost"}
        aria-pressed={view === "list"}
        onClick={() => onViewChange("list")}
        className="gap-1.5"
      >
        <List className="size-3.5" aria-hidden="true" />
        List
      </Button>
      <Button
        type="button"
        size="xs"
        variant={view === "kanban" ? "default" : "ghost"}
        aria-pressed={view === "kanban"}
        onClick={() => onViewChange("kanban")}
        className="gap-1.5"
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
        Kanban
      </Button>
    </div>
  );
}
