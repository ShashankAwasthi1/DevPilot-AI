import { API_URL } from "./api";
import type { TaskPriority, TaskStatus } from "./types";

// Mirrors the server's TurnEvent | AgentTurnEvent union (see
// server/src/ai/tool-loop.ts and server/src/ai/agent-runner.ts) - a single
// discriminated event type scales to both chat and agent mode without a
// growing list of positional callbacks.
export interface DocumentSourceRef {
  documentId: string;
  title: string;
}

// Mirrors server/src/ai/tools/create-task.tool.ts's own
// PendingTaskActionRef exactly - the UI-facing presentation payload for an
// AI-proposed task creation, carried by the "pending_action" SSE event
// (server/src/ai/tool-loop.ts's extractPendingAction). Reuses the existing
// TaskStatus/TaskPriority types rather than re-declaring the enum values a
// second time. Deliberately contains no projectId/userId/conversationId -
// this is display data only; confirming/cancelling is authorized fresh,
// server-side, by the Step 7A endpoints regardless of what this object
// says (see lib/pending-actions.ts).
export interface PendingTaskActionRef {
  actionType: "CREATE_TASK";
  actionId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  expiresAt: string;
}

// Phase 24: mirrors server/src/ai/tools/update-task.tool.ts's own
// FieldChange/UpdateTaskPendingActionRef exactly. `from`/`to` are always
// plain strings or null - a raw enum value (e.g. "DONE"), a plain id, or
// plain text - never model-authored display prose; formatting them into
// human-readable labels/names is this client's job (see
// lib/pending-action-format.ts), not the server's.
export type FieldChangeField = "title" | "description" | "status" | "priority" | "assigneeId" | "dueDate";

export interface FieldChange {
  field: FieldChangeField;
  from: string | null;
  to: string | null;
}

export interface UpdateTaskPendingActionRef {
  actionType: "UPDATE_TASK";
  actionId: string;
  taskId: string;
  taskTitle: string;
  expiresAt: string;
  changes: FieldChange[];
}

// The one payload a "pending_action" SSE event ever carries, discriminated
// by actionType - mirrors server/src/ai/tool-loop.ts's own PendingActionRef
// union exactly.
export type PendingActionRef = PendingTaskActionRef | UpdateTaskPendingActionRef;

export type StreamChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "source"; sources: DocumentSourceRef[] }
  | { type: "pending_action"; pendingAction: PendingActionRef }
  | { type: "done" }
  | { type: "error"; message: string };

export interface StreamChatOptions {
  // Defaults to "chat" below so a caller that omits this keeps exercising
  // exactly the same server-side path (runChatTurn) as before this option
  // existed - existing behavior is unchanged unless a caller opts in.
  mode?: "chat" | "agent";
  onEvent: (event: StreamChatEvent) => void;
}

// Separate from api.ts's request() helper because that awaits a full JSON
// body - this reads the response incrementally as Server-Sent Events
// arrive. Uses the same credentials/base-URL convention as api.ts, but a
// raw fetch + stream reader instead of response.json().
export async function streamChatMessage(
  projectId: string,
  conversationId: string,
  content: string,
  options: StreamChatOptions,
  signal?: AbortSignal,
): Promise<void> {
  const mode = options.mode ?? "chat";
  const { onEvent } = options;

  let response: Response;

  try {
    response = await fetch(
      `${API_URL}/projects/${projectId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode }),
        signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    onEvent({ type: "error", message: "Could not reach the server. Check your connection." });
    return;
  }

  if (!response.ok || !response.body) {
    let message = "Something went wrong.";
    try {
      const body = (await response.json()) as { message?: string };
      message = body?.message ?? message;
    } catch {
      // Non-JSON error body - fall back to the generic message.
    }
    onEvent({ type: "error", message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;

        if (parsed.event === "done") {
          onEvent({ type: "done" });
          return;
        }

        if (parsed.event === "error") {
          const data = parsed.data ? (JSON.parse(parsed.data) as { message?: string }) : {};
          onEvent({ type: "error", message: data.message ?? "Something went wrong generating a response." });
          return;
        }

        if (parsed.event === "tool_call") {
          if (!parsed.data) continue;
          // Forward exactly the two safe fields the backend sends - never
          // more, never a raw tool result (the backend itself never sends
          // one in this event).
          const data = JSON.parse(parsed.data) as { name?: string; input?: unknown };
          if (typeof data.name === "string") {
            onEvent({ type: "tool_call", name: data.name, input: data.input });
          }
          continue;
        }

        if (parsed.event === "tool_result") {
          if (!parsed.data) continue;
          // Same safety guarantee as tool_call - name + ok only.
          const data = JSON.parse(parsed.data) as { name?: string; ok?: boolean };
          if (typeof data.name === "string" && typeof data.ok === "boolean") {
            onEvent({ type: "tool_result", name: data.name, ok: data.ok });
          }
          continue;
        }

        if (parsed.event === "source") {
          if (!parsed.data) continue;
          // Defensive parsing - never pass an arbitrary server payload
          // straight into UI state. Only documentId/title, both non-empty
          // strings, survive; anything else is silently dropped.
          const data = JSON.parse(parsed.data) as { sources?: unknown };
          if (Array.isArray(data.sources)) {
            const sources: DocumentSourceRef[] = data.sources.filter(
              (entry): entry is DocumentSourceRef =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { documentId?: unknown }).documentId === "string" &&
                (entry as { documentId: string }).documentId.length > 0 &&
                typeof (entry as { title?: unknown }).title === "string" &&
                (entry as { title: string }).title.length > 0,
            );
            if (sources.length > 0) {
              onEvent({ type: "source", sources });
            }
          }
          continue;
        }

        if (parsed.event === "pending_action") {
          if (!parsed.data) continue;
          const pendingAction = parsePendingActionRef(JSON.parse(parsed.data) as unknown);
          if (pendingAction) {
            onEvent({ type: "pending_action", pendingAction });
          }
          continue;
        }

        if (parsed.data) {
          const data = JSON.parse(parsed.data) as { delta?: string };
          if (typeof data.delta === "string") {
            onEvent({ type: "text", text: data.delta });
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    onEvent({ type: "error", message: "Something went wrong generating a response." });
    return;
  }

  onEvent({ type: "done" });
}

const TASK_STATUSES = new Set<TaskStatus>(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
const TASK_PRIORITIES = new Set<TaskPriority>(["LOW", "MEDIUM", "HIGH", "URGENT"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const VALID_CHANGE_FIELDS = new Set<FieldChangeField>([
  "title",
  "description",
  "status",
  "priority",
  "assigneeId",
  "dueDate",
]);

function isValidFieldChange(value: unknown): value is FieldChange {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.field === "string" &&
    VALID_CHANGE_FIELDS.has(entry.field as FieldChangeField) &&
    isStringOrNull(entry.from) &&
    isStringOrNull(entry.to)
  );
}

function parseCreateTaskPendingActionRef(value: Record<string, unknown>): PendingTaskActionRef | null {
  if (
    !isNonEmptyString(value.actionId) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.expiresAt) ||
    typeof value.status !== "string" ||
    !TASK_STATUSES.has(value.status as TaskStatus) ||
    typeof value.priority !== "string" ||
    !TASK_PRIORITIES.has(value.priority as TaskPriority) ||
    !isStringOrNull(value.description ?? null) ||
    !isStringOrNull(value.assigneeId ?? null) ||
    !isStringOrNull(value.assigneeName ?? null) ||
    !isStringOrNull(value.dueDate ?? null)
  ) {
    return null;
  }

  return {
    actionType: "CREATE_TASK",
    actionId: value.actionId,
    title: value.title,
    description: (value.description as string | null | undefined) ?? null,
    status: value.status as TaskStatus,
    priority: value.priority as TaskPriority,
    assigneeId: (value.assigneeId as string | null | undefined) ?? null,
    assigneeName: (value.assigneeName as string | null | undefined) ?? null,
    dueDate: (value.dueDate as string | null | undefined) ?? null,
    expiresAt: value.expiresAt,
  };
}

// Mirrors server/src/ai/tool-loop.ts's own extractPendingAction validation
// for an UPDATE_TASK proposal exactly: every required field must be a
// non-empty string, `changes` must be an array, and only individually
// well-formed entries survive - an entry naming an unrecognized field, or
// with a non-string/non-null from/to, is dropped rather than trusted. A
// proposal with zero valid changes left is treated as malformed (a real
// one always has at least one, per the server's own no-op rejection).
function parseUpdateTaskPendingActionRef(value: Record<string, unknown>): UpdateTaskPendingActionRef | null {
  if (
    !isNonEmptyString(value.actionId) ||
    !isNonEmptyString(value.taskId) ||
    !isNonEmptyString(value.taskTitle) ||
    !isNonEmptyString(value.expiresAt) ||
    !Array.isArray(value.changes)
  ) {
    return null;
  }

  const changes = value.changes.filter(isValidFieldChange);
  if (changes.length === 0) return null;

  return {
    actionType: "UPDATE_TASK",
    actionId: value.actionId,
    taskId: value.taskId,
    taskTitle: value.taskTitle,
    expiresAt: value.expiresAt,
    changes,
  };
}

// Defensive shape/enum validation for one parsed "pending_action" JSON
// body - same posture as the "source" event's own inline filter just
// below: never pass an arbitrary server payload straight into UI state.
// Returns null (never throws) for anything missing a required field,
// carrying an unrecognized enum value, or naming an unrecognized
// actionType, so a malformed frame is silently dropped rather than
// crashing the stream - a JSON syntax error in the frame itself still
// bubbles to this function's caller's own try/catch, exactly like every
// other event type here.
function parsePendingActionRef(data: unknown): PendingActionRef | null {
  if (typeof data !== "object" || data === null) return null;
  const value = data as Record<string, unknown>;

  if (value.actionType === "CREATE_TASK") return parseCreateTaskPendingActionRef(value);
  if (value.actionType === "UPDATE_TASK") return parseUpdateTaskPendingActionRef(value);
  return null;
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  if (!frame.trim()) return null;

  let event = "message";
  let data = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data = line.slice(6);
  }

  return { event, data };
}
