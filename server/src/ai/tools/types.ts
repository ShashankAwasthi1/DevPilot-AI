import type { ZodType } from "zod";

// projectId/userId/conversationId are never tool arguments - they come
// exclusively from this context, injected server-side from the
// already-authenticated, already-verified conversation (see
// message.controller.ts). No tool schema below ever declares any of these
// fields, so there is nothing for a model to even attempt to override.
// conversationId (Phase 19) exists so a tool can record which conversation
// an action was proposed in (see create-task.tool.ts's PendingTaskAction).
// Optional rather than required: message.controller.ts (the only real
// caller) always supplies it, but making it required would force every
// existing ToolContext literal across this codebase's many read-only-tool
// tests to be updated for a field none of them use - unnecessary churn for
// tools that have no use for it and simply ignore it.
export interface ToolContext {
  userId: string;
  projectId: string;
  conversationId?: string;
}

export interface ToolDefinition<Args = unknown> {
  name: string;
  description: string;
  schema: ZodType<Args>;
  handler: (args: Args, ctx: ToolContext) => Promise<unknown>;
}
