import { NextFunction, Request, Response } from "express";
import * as projectMemberService from "../services/project-member.service";

export async function listProjectMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const members = await projectMemberService.listProjectMembers(req.user!.id, req.params.id);
    res.status(200).json({ status: "ok", data: { members } });
  } catch (err) {
    next(err);
  }
}
