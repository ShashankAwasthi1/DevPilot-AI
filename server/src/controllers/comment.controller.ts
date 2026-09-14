import { NextFunction, Request, Response } from "express";
import * as commentService from "../services/comment.service";

export async function listComments(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await commentService.listCommentsForTask(req.user!.id, req.params.taskId);
    res.status(200).json({ status: "ok", data: { comments } });
  } catch (err) {
    next(err);
  }
}

export async function createComment(req: Request, res: Response, next: NextFunction) {
  try {
    // authorId always comes from the verified session, never the body.
    const comment = await commentService.createComment(
      req.user!.id,
      req.params.taskId,
      req.body,
    );
    res.status(201).json({ status: "ok", data: { comment } });
  } catch (err) {
    next(err);
  }
}
