import { z } from "zod";

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    // Restricted to http(s) - the field may end up rendered as a link/image
    // source on the frontend, so schemes like `javascript:` must never be
    // accepted even though they're syntactically valid URLs.
    avatarUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .regex(/^https?:\/\//, "avatarUrl must start with http:// or https://")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field (name, avatarUrl) must be provided",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
