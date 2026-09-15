import type { TaskPriority, TaskStatus } from "@/lib/types";

// Shared label/order constants for status and priority - used by both
// task-list.tsx (row badges) and task-filters.tsx (filter/sort options),
// split into its own module so neither component needs to import the
// other just to reuse these maps.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};

export const STATUS_BADGE_VARIANT: Record<TaskStatus, "outline" | "secondary" | "default"> = {
  TODO: "outline",
  IN_PROGRESS: "secondary",
  IN_REVIEW: "secondary",
  DONE: "default",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, "outline" | "secondary" | "destructive"> = {
  LOW: "outline",
  MEDIUM: "outline",
  HIGH: "secondary",
  URGENT: "destructive",
};

// Deterministic sort order for the Priority sort option - URGENT first.
export const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
