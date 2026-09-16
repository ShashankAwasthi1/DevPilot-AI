import { NextFunction, Request, Response } from "express";
import * as pendingTaskActionService from "../services/pending-task-action.service";

// No request body for either endpoint - projectId/conversationId come
// from the route (already authenticated/scoped the same way every other
// route under conversation.routes.ts is), and userId comes only from the
// verified session. There is nothing here for a client to supply that
// could influence which action is acted on or how.
export async function confirmPendingTaskAction(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await pendingTaskActionService.confirmPendingTaskAction(
      req.params.actionId,
      req.params.projectId,
      req.params.conversationId,
      req.user!.id,
    );
    res.status(200).json({ status: "ok", data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function cancelPendingTaskAction(req: Request, res: Response, next: NextFunction) {
  try {
    const action = await pendingTaskActionService.cancelPendingTaskAction(
      req.params.actionId,
      req.params.projectId,
      req.params.conversationId,
      req.user!.id,
    );
    res.status(200).json({ status: "ok", data: { action } });
  } catch (err) {
    next(err);
  }
}
