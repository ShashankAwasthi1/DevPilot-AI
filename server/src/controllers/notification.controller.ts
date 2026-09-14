import { NextFunction, Request, Response } from "express";
import * as notificationService from "../services/notification.service";
import { AppError } from "../utils/AppError";
import { listNotificationsQuerySchema } from "../validation/notification.validation";

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    // Query params need their own validation - the shared `validate()`
    // middleware only covers req.body, so this mirrors its exact
    // safeParse/AppError(400, ...) shape for query params instead.
    const parsed = listNotificationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, "Validation failed", parsed.error.flatten().fieldErrors));
      return;
    }

    const result = await notificationService.listNotificationsForUser(req.user!.id, parsed.data);
    res.status(200).json({ status: "ok", data: result });
  } catch (err) {
    next(err);
  }
}

export async function markNotificationAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const notification = await notificationService.markNotificationAsRead(
      req.user!.id,
      req.params.id,
    );
    res.status(200).json({ status: "ok", data: { notification } });
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAllNotificationsAsRead(req.user!.id);
    res.status(200).json({ status: "ok", data: result });
  } catch (err) {
    next(err);
  }
}
