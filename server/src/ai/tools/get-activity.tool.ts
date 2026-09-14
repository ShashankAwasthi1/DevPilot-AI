import { z } from "zod";
import { listActivityForProject } from "../../services/activity.service";
import { AI_LIMITS } from "../limits";
import type { ToolDefinition } from "./types";

const schema = z
  .object({
    limit: z.number().int().min(1).max(AI_LIMITS.MAX_ACTIVITY_ITEMS).optional(),
  })
  .strict();

export const getActivityTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "getActivity",
  description: "Get the most recent activity (comments, document changes) in the current project.",
  schema,
  handler: async (args, ctx) => {
    // listActivityForProject now performs the bounded, deterministically-
    // ordered (createdAt desc, id desc) fetch at the database level when a
    // limit is passed - already newest-first, no in-memory slice/reverse.
    const activity = await listActivityForProject(
      ctx.userId,
      ctx.projectId,
      args.limit ?? AI_LIMITS.MAX_ACTIVITY_ITEMS,
    );
    return activity.map((item) => ({ type: item.type, createdAt: item.createdAt }));
  },
};
