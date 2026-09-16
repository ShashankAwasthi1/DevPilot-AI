import { PRIORITY_LABEL, STATUS_LABEL } from "@/components/tasks/task-labels";
import type { FieldChangeField } from "./ai-chat";
import type { ProjectMember, TaskPriority, TaskStatus } from "./types";

// Human-readable field names for the "Changes" list in an UPDATE_TASK
// confirmation card - kept as a fixed lookup, never derived from the raw
// field string, so an unrecognized field (already filtered out during SSE
// parsing - see lib/ai-chat.ts's isValidFieldChange) can never surface a
// raw identifier to the user.
export const FIELD_LABEL: Record<FieldChangeField, string> = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
  dueDate: "Due date",
};

function memberLabel(member: ProjectMember): string {
  return member.name || member.email;
}

// Never a network request - resolved entirely from the already-loaded
// ProjectMember[] a caller may have available (see task-comments.tsx/
// task-activity.tsx for the same pattern elsewhere in this app). `null`
// means "no assignee" (Unassigned); a non-null id with no matching member
// falls back to a safe, non-identifying label rather than a raw id.
export function formatAssignee(value: string | null, members: ProjectMember[]): string {
  if (value === null) return "Unassigned";
  const member = members.find((m) => m.userId === value);
  return member ? memberLabel(member) : "Unknown member";
}

function formatDueDate(value: string | null): string {
  if (value === null) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No due date" : date.toLocaleDateString();
}

// Renders one side (from/to) of a FieldChange as safe, human-readable
// text - never a raw enum value, a raw id, or a bare `null`/`undefined`.
// `members` is optional and defaults to empty (see pending-action-card.tsx
// - the chat surface this card renders in doesn't currently load a
// project's member list, so assignee changes fall back to "Unknown
// member"/"Unassigned" rather than a resolved name; passing a real list
// in makes resolution work with no other change needed here).
export function formatFieldValue(field: FieldChangeField, value: string | null, members: ProjectMember[] = []): string {
  switch (field) {
    case "status":
      return value !== null && value in STATUS_LABEL ? STATUS_LABEL[value as TaskStatus] : "—";
    case "priority":
      return value !== null && value in PRIORITY_LABEL ? PRIORITY_LABEL[value as TaskPriority] : "—";
    case "assigneeId":
      return formatAssignee(value, members);
    case "dueDate":
      return formatDueDate(value);
    case "description":
      return value !== null && value.length > 0 ? value : "No description";
    case "title":
      return value !== null && value.length > 0 ? value : "Untitled";
    default:
      return value ?? "—";
  }
}
