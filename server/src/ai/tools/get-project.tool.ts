import { z } from "zod";
import { getProjectForUser } from "../../services/project.service";
import type { ToolDefinition } from "./types";

const schema = z.object({}).strict();

export const getProjectTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "getProject",
  description: "Get the name, description, and status of the current project.",
  schema,
  handler: async (_args, ctx) => {
    const project = await getProjectForUser(ctx.userId, ctx.projectId);
    return {
      name: project.name,
      description: project.description,
      archived: !!project.archivedAt,
    };
  },
};
