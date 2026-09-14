import { z } from "zod";

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(50000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field (title, content) must be provided",
  });

// Query params arrive as strings (or undefined) - coerce/parse explicitly,
// same pattern as notification.validation.ts's list schema.
export const listDocumentsQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchDocumentsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type SearchDocumentsQuery = z.infer<typeof searchDocumentsQuerySchema>;
