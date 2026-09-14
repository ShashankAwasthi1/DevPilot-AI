import { z } from "zod";
import { listTaskSummariesForProject } from "../../services/task.service";
import { AI_LIMITS } from "../limits";
import type { ToolDefinition } from "./types";

const schema = z
  .object({
    limit: z.number().int().min(1).max(AI_LIMITS.MAX_TASKS).optional(),
  })
  .strict();

export const getTasksTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "getTasks",
  description: "List tasks in the current project, most recently updated first.",
  schema,
  handler: async (args, ctx) =>
    // listTaskSummariesForProject requires a concrete limit (no default of
    // its own) - the tool supplies one.
    listTaskSummariesForProject(ctx.userId, ctx.projectId, args.limit ?? AI_LIMITS.MAX_TASKS),
};
