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

export async function addProjectMember(req: Request, res: Response, next: NextFunction) {
  try {
    const member = await projectMemberService.addProjectMember(req.user!.id, req.params.id, req.body);
    res.status(201).json({ status: "ok", data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function updateProjectMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const member = await projectMemberService.updateProjectMemberRole(
      req.user!.id,
      req.params.id,
      req.params.userId,
      req.body,
    );
    res.status(200).json({ status: "ok", data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function removeProjectMember(req: Request, res: Response, next: NextFunction) {
  try {
    const member = await projectMemberService.removeProjectMember(req.user!.id, req.params.id, req.params.userId);
    res.status(200).json({ status: "ok", data: { member } });
  } catch (err) {
    next(err);
  }
}
