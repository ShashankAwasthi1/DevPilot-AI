import { createTaskTool } from "./create-task.tool";
import { generateProjectPlanTool } from "./generate-project-plan.tool";
import { getActivityTool } from "./get-activity.tool";
import { getDocumentsTool } from "./get-documents.tool";
import { getProjectTool } from "./get-project.tool";
import { getTasksTool } from "./get-tasks.tool";
import { searchDocumentsTool } from "./search-documents.tool";
import { updateTaskTool } from "./update-task.tool";
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
// updateTask (Phase 24 Step 2) is registered here so it's discoverable and
// independently testable, but tool-loop.ts/agent-runner.ts do not yet
// recognize it by name the way they do createTask (that recognition, plus
// the pendingAction/SSE bridge, is Phase 24 Step 4) - until then, a real
// model call to this tool proposes correctly (never mutates a Task) but
// its result is not yet surfaced as a confirmation card.
//
// generateProjectPlan (Phase 25 Step 2) is registered under the exact same
// interim posture as updateTask above: discoverable and independently
// testable now, but tool-loop.ts/agent-runner.ts don't yet recognize it by
// name (that's a later Phase 25 step) - until then it proposes correctly
// (never creates a Task) but isn't yet surfaced as a confirmation card.
export const TOOLS: ToolDefinition<any>[] = [
  getProjectTool,
  getTasksTool,
  getDocumentsTool,
  getActivityTool,
  searchDocumentsTool,
  createTaskTool,
  updateTaskTool,
  generateProjectPlanTool,
];

export type { ToolContext, ToolDefinition } from "./types";
