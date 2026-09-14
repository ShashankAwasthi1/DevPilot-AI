import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field (name, description) must be provided",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
