import { NextFunction, Request, Response } from "express";
import * as activityService from "../services/activity.service";

const DASHBOARD_ACTIVITY_LIMIT = 10;

export async function getDashboardActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const activity = await activityService.listActivityForUser(
      req.user!.id,
      DASHBOARD_ACTIVITY_LIMIT,
    );
    res.status(200).json({ status: "ok", data: { activity } });
  } catch (err) {
    next(err);
  }
}
