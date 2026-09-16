import { createTaskTool } from "./create-task.tool";
import { getActivityTool } from "./get-activity.tool";
import { getDocumentsTool } from "./get-documents.tool";
import { getProjectTool } from "./get-project.tool";
import { getTasksTool } from "./get-tasks.tool";
import { searchDocumentsTool } from "./search-documents.tool";
import type { ToolDefinition } from "./types";

// The complete set of project-scoped tools available to the AI.
// searchDocuments (Phase 14) is additive to getDocuments (Phase 13), not a
// replacement - getDocuments remains plain title/content listing/search;
// searchDocuments adds semantic (embedding-based) search on top.
//
// createTask (Phase 19) is the one tool that isn't purely read-only, but it
// never writes a Task itself - it only stages a PendingTaskAction row for a
// separately-authenticated confirmation step (a later Phase 19 step) to
// act on. See create-task.tool.ts's own doc comment for why this is safe
// to register here without changing tool-loop.ts's/agent-runner.ts's
// dispatch mechanics at all.
//
// ToolDefinition<any> here (not <unknown>) is the standard, safe pattern for
// a heterogeneous registry of independently-typed handlers - each tool's
// own Zod schema.parse() is what actually re-validates its args at runtime
// regardless of this array's static element type.
export const TOOLS: ToolDefinition<any>[] = [
  getProjectTool,
  getTasksTool,
  getDocumentsTool,
  getActivityTool,
  searchDocumentsTool,
  createTaskTool,
];

export type { ToolContext, ToolDefinition } from "./types";
