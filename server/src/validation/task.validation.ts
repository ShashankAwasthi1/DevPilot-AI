import { z } from "zod";

// Mirrors the TaskStatus/TaskPriority enums in schema.prisma exactly.
// Kept as explicit Zod enums (not an import of the Prisma runtime enum)
// so this layer stays independent of the generated Prisma client, same
// as every other validation file in this directory.
const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

// dueDate travels over the wire as an ISO-8601 datetime string (offset or
// "Z" both accepted) or null to clear it - no bespoke date-only format,
// and no transform into a Date here; the service layer decides how to
// hand this string to Prisma. `nullable().optional()` lets a caller
// either omit the field (create: no due date; update: leave unchanged)
// or send an explicit null (clear a due date).
const dueDateSchema = z.iso.datetime({ offset: true }).nullable().optional();

// description is nullable in Prisma (Task.description: String?), so both
// schemas accept null explicitly (clear it) alongside a normal string.
const descriptionSchema = z.string().trim().max(10000).nullable().optional();

// assigneeId is nullable in Prisma (Task.assigneeId: String?) - null
// unassigns. No format constraint beyond "non-empty string or null";
// resolving whether the id actually refers to a project member is the
// service layer's job, not this schema's.
const assigneeIdSchema = z.string().trim().min(1).nullable().optional();

// Neither schema accepts projectId or createdById - both are derived
// exclusively from the route param and the authenticated session (same
// rule createConversationSchema/updateConversationSchema already follow
// for conversations). Plain z.object() is used deliberately, matching
// the existing convention across every validation file in this
// directory: unknown keys are stripped silently rather than rejected,
// so neither field can ever reach the service through this schema's
// output regardless of what a caller sends.
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: descriptionSchema,
  status: taskStatusSchema.default("TODO"),
  priority: taskPrioritySchema.default("MEDIUM"),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
});

// No defaults here - every field is optional and an omitted field means
// "leave unchanged", not "reset to TODO/MEDIUM". Only an explicit null on
// description/assigneeId/dueDate clears that field.
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: descriptionSchema,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
});

// Query params arrive as strings (or undefined) - coerce/parse explicitly,
// same pattern as conversation.validation.ts's/document.validation.ts's
// list schemas. No cursor here - listTaskSummariesForProject doesn't
// support cursor pagination yet, so there's nothing to validate for it.
export const listTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
