import { z } from "zod";

// Query params arrive as strings (or undefined) - coerce/parse explicitly
// rather than trusting shape, and bound `limit` so a client can't request
// an unbounded page.
export const listNotificationsQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
