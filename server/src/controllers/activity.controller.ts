import { NextFunction, Request, Response } from "express";
import * as activityService from "../services/activity.service";

export async function listActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const activity = await activityService.listActivityForProject(
      req.user!.id,
      req.params.id,
    );
    res.status(200).json({ status: "ok", data: { activity } });
  } catch (err) {
    next(err);
  }
}
