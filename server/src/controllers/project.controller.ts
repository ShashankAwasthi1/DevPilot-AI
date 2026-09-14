import { NextFunction, Request, Response } from "express";
import * as projectService from "../services/project.service";

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    // req.user.id comes from the verified session (requireAuth) - the
    // client can never choose who owns the project it creates.
    const project = await projectService.createProject(req.user!.id, req.body);
    res.status(201).json({ status: "ok", data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function listProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const projects = await projectService.listProjectsForUser(req.user!.id, includeArchived);
    res.status(200).json({ status: "ok", data: { projects } });
  } catch (err) {
    next(err);
  }
}

export async function getProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.getProjectForUser(req.user!.id, req.params.id);
    res.status(200).json({ status: "ok", data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function updateProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.updateProject(req.user!.id, req.params.id, req.body);
    res.status(200).json({ status: "ok", data: { project } });
  } catch (err) {
    next(err);
  }
}

export async function archiveProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.archiveProject(req.user!.id, req.params.id);
    res.status(200).json({ status: "ok", data: { project } });
  } catch (err) {
    next(err);
  }
}
