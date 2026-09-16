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

// "OWNER" is deliberately excluded - it is represented by Project.ownerId,
// never a stored ProjectMember row (see project.service.ts's computeRole),
// so it is not a valid role to request for a new membership.
export const addProjectMemberSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

// Same "OWNER" exclusion as addProjectMemberSchema, for the same reason -
// OWNER is never a value a ProjectMember row can hold.
export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleSchema>;
