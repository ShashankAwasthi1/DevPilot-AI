import { NextFunction, Request, Response } from "express";
import * as userService from "../services/user.service";

export function getMe(req: Request, res: Response) {
  res.status(200).json({ status: "ok", data: { user: req.user } });
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    // req.user.id comes from the verified session (requireAuth), never
    // from the request body - a client can only ever update itself.
    const user = await userService.updateProfile(req.user!.id, req.body);
    res.status(200).json({ status: "ok", data: { user } });
  } catch (err) {
    next(err);
  }
}
