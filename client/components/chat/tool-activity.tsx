"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, CircleX, Loader2 } from "lucide-react";

export interface ToolActivityItem {
  id: string;
  name: string;
  status: "running" | "success" | "error";
}

// Safe, human-readable labels only - the raw tool name is never rendered
// directly, so an unfamiliar/unexpected name can never surface as-is.
const TOOL_LABELS: Record<string, string> = {
  getProject: "Reading project details",
  getTasks: "Checking project tasks",
  getDocuments: "Reading project documents",
  getActivity: "Checking project activity",
  searchDocuments: "Searching project knowledge",
};

const UNKNOWN_TOOL_LABEL = "Using project tool";

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? UNKNOWN_TOOL_LABEL;
}

// A status suffix is always appended to the visible text itself (not just
// conveyed by icon/color) so the state is understandable without relying
// on icons alone.
function statusText(item: ToolActivityItem): string {
  const label = toolLabel(item.name);
  if (item.status === "running") return `${label}…`;
  if (item.status === "error") return `${label} — failed`;
  return `${label} — done`;
}

interface ToolActivityProps {
  items: ToolActivityItem[];
}

// Compact, secondary-to-the-answer activity list for tool_call/tool_result
// SSE events (agent mode). Never receives or renders raw tool input/result
// - the caller only ever gives it a name + status, matching exactly what
// the backend's SSE events expose in the first place.
export function ToolActivity({ items }: ToolActivityProps) {
  const prefersReducedMotion = useReducedMotion();

  if (items.length === 0) return null;

  return (
    <ul aria-label="Tool activity" aria-live="polite" className="mb-1 flex flex-col gap-1">
      {items.map((item, index) => (
        <motion.li
          key={item.id}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, delay: prefersReducedMotion ? 0 : index * 0.03 }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {item.status === "running" && (
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
          )}
          {item.status === "success" && (
            <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
          )}
          {item.status === "error" && <CircleX className="size-3 shrink-0 text-destructive" aria-hidden="true" />}
          <span>{statusText(item)}</span>
        </motion.li>
      ))}
    </ul>
  );
}
