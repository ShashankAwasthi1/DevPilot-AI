import { NextFunction, Request, Response } from "express";
import * as taskService from "../services/task.service";
import { AppError } from "../utils/AppError";
import { listTasksQuerySchema } from "../validation/task.validation";

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    // req.user.id comes from the verified session (requireAuth), and
    // projectId from the route param - createTaskSchema doesn't even
    // declare projectId/createdById, so req.body can never supply either.
    const task = await taskService.createTask(req.user!.id, req.params.projectId, req.body);
    res.status(201).json({ status: "ok", data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function listTasks(req: Request, res: Response, next: NextFunction) {
  try {
    // Query params need their own validation - mirrors
    // document.controller.ts's manual safeParse/AppError(400, ...) shape,
    // since the shared `validate()` middleware only covers req.body.
    const parsed = listTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, "Validation failed", parsed.error.flatten().fieldErrors));
      return;
    }

    const tasks = await taskService.listTaskSummariesForProject(
      req.user!.id,
      req.params.projectId,
      parsed.data.limit,
    );
    res.status(200).json({ status: "ok", data: { tasks } });
  } catch (err) {
    next(err);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.updateTask(req.user!.id, req.params.id, req.body);
    res.status(200).json({ status: "ok", data: { task } });
  } catch (err) {
    next(err);
  }
}

// Responds 200 with an empty data object rather than 204, since the
// client's request() helper (client/lib/api.ts) always attempts to parse a
// JSON envelope from the response body, even for DELETE - same convention
// as conversation.controller.ts's deleteConversation.
export async function deleteTask(req: Request, res: Response, next: NextFunction) {
  try {
    await taskService.deleteTask(req.user!.id, req.params.id);
    res.status(200).json({ status: "ok", data: {} });
  } catch (err) {
    next(err);
  }
}
