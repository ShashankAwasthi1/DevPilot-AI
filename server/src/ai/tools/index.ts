import { getActivityTool } from "./get-activity.tool";
import { getDocumentsTool } from "./get-documents.tool";
import { getProjectTool } from "./get-project.tool";
import { getTasksTool } from "./get-tasks.tool";
import type { ToolDefinition } from "./types";

// The complete, fixed set of read-only tools available to the AI in Phase
// 13. No mutation tools exist anywhere in this registry.
//
// ToolDefinition<any> here (not <unknown>) is the standard, safe pattern for
// a heterogeneous registry of independently-typed handlers - each tool's
// own Zod schema.parse() is what actually re-validates its args at runtime
// regardless of this array's static element type.
export const TOOLS: ToolDefinition<any>[] = [getProjectTool, getTasksTool, getDocumentsTool, getActivityTool];

export type { ToolContext, ToolDefinition } from "./types";
