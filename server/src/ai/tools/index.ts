import { getActivityTool } from "./get-activity.tool";
import { getDocumentsTool } from "./get-documents.tool";
import { getProjectTool } from "./get-project.tool";
import { getTasksTool } from "./get-tasks.tool";
import { searchDocumentsTool } from "./search-documents.tool";
import type { ToolDefinition } from "./types";

// The complete, fixed set of read-only tools available to the AI. No
// mutation tools exist anywhere in this registry. searchDocuments (Phase
// 14) is additive to getDocuments (Phase 13), not a replacement -
// getDocuments remains plain title/content listing/search; searchDocuments
// adds semantic (embedding-based) search on top.
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
];

export type { ToolContext, ToolDefinition } from "./types";
