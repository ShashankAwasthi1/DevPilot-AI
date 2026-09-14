import { z } from "zod";
import { listDocumentsForProject, searchDocumentsInProject } from "../../services/document.service";
import { AI_LIMITS } from "../limits";
import type { ToolDefinition } from "./types";

const schema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(AI_LIMITS.MAX_CONTEXT_DOCUMENTS).optional(),
  })
  .strict();

export const getDocumentsTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "getDocuments",
  description: "List or search the current project's documents by title/content keyword.",
  schema,
  handler: async (args, ctx) => {
    const limit = args.limit ?? AI_LIMITS.MAX_CONTEXT_DOCUMENTS;

    if (args.query) {
      // searchDocumentsInProject has no limit param of its own - it's
      // server-capped at 20 internally; slicing further down here is safe
      // and never asks the service for more than it already returns.
      const docs = await searchDocumentsInProject(ctx.userId, ctx.projectId, args.query);
      return docs
        .slice(0, limit)
        .map((doc) => ({ title: doc.title, content: doc.content.slice(0, AI_LIMITS.MAX_DOCUMENT_CHARS_EACH) }));
    }

    // listDocumentsForProject returns a paginated { documents, nextCursor }
    // object, not a bare array - destructure accordingly.
    const { documents } = await listDocumentsForProject(ctx.userId, ctx.projectId, { limit });
    return documents.map((doc) => ({
      title: doc.title,
      content: doc.content.slice(0, AI_LIMITS.MAX_DOCUMENT_CHARS_EACH),
    }));
  },
};
