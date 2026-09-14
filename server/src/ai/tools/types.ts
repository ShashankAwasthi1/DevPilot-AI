import type { ZodType } from "zod";

// projectId/userId are never tool arguments - they come exclusively from
// this context, injected server-side from the already-authenticated,
// already-verified conversation (see message.controller.ts). No tool
// schema below ever declares either field, so there is nothing for a model
// to even attempt to override.
export interface ToolContext {
  userId: string;
  projectId: string;
}

export interface ToolDefinition<Args = unknown> {
  name: string;
  description: string;
  schema: ZodType<Args>;
  handler: (args: Args, ctx: ToolContext) => Promise<unknown>;
}
