import { NextFunction, Request, Response } from "express";
import * as pendingTaskActionService from "../services/pending-task-action.service";

// No request body for either endpoint - projectId/conversationId come
// from the route (already authenticated/scoped the same way every other
// route under conversation.routes.ts is), and userId comes only from the
// verified session. There is nothing here for a client to supply that
// could influence which action is acted on or how.
export async function confirmPendingTaskAction(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pendingTaskActionService.confirmPendingTaskAction(
      req.params.actionId,
      req.params.projectId,
      req.params.conversationId,
      req.user!.id,
    );

    // CREATE_TASK/UPDATE_TASK confirmations resolve to a single TaskDto;
    // a CREATE_PROJECT_PLAN confirmation (Phase 25 Step 3) resolves to an
    // array of them - the only two shapes confirmPendingTaskAction can
    // ever return. Discriminating on Array.isArray keeps the existing
    // { task } response byte-for-byte unchanged for the two pre-existing
    // action types, while giving the new plural case its own { tasks }
    // shape rather than overloading the singular one.
    if (Array.isArray(result)) {
      res.status(200).json({ status: "ok", data: { tasks: result } });
      return;
    }

    res.status(200).json({ status: "ok", data: { task: result } });
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
