import { z } from "zod";
import { AI_LIMITS } from "../ai/limits";

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(AI_LIMITS.MAX_USER_MESSAGE_LENGTH),
});

// Query params arrive as strings (or undefined) - coerce/parse explicitly,
// same pattern as document.validation.ts's list schema.
export const listConversationsQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
