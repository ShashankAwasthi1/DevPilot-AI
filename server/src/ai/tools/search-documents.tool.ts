import { z } from "zod";
import { retrieveRelevantChunks } from "../../services/document-retrieval.service";
import { AI_LIMITS } from "../limits";
import type { ToolDefinition } from "./types";

const schema = z
  .object({
    query: z.string().trim().min(1).max(AI_LIMITS.MAX_SEARCH_QUERY_LENGTH),
    limit: z.number().int().min(1).max(AI_LIMITS.MAX_SEARCH_RESULTS).optional(),
  })
  .strict();

export const searchDocumentsTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "searchDocuments",
  description:
    "Search the current project's documentation/knowledge-base content by meaning, not just keywords. Use this when the user asks about information that may exist inside project documentation and the project context you already have is insufficient - not for every question.",
  schema,
  handler: async (args, ctx) => {
    const results = await retrieveRelevantChunks(
      ctx.userId,
      ctx.projectId,
      args.query,
      args.limit ?? AI_LIMITS.MAX_SEARCH_RESULTS,
    );
    // Only what the model needs to answer and cite a source - never the
    // embedding, chunk/document ids, or distance score.
    return results.map((r) => ({ documentTitle: r.documentTitle, content: r.content }));
  },
};
