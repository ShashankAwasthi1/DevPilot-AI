import { NextFunction, Request, Response } from "express";
import * as conversationService from "../services/conversation.service";
import * as messageService from "../services/message.service";
import { AppError } from "../utils/AppError";
import { listConversationsQuerySchema } from "../validation/conversation.validation";

export async function createConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await conversationService.createConversation(
      req.user!.id,
      req.params.projectId,
      req.body,
    );
    res.status(201).json({ status: "ok", data: { conversation } });
  } catch (err) {
    next(err);
  }
}

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listConversationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, "Validation failed", parsed.error.flatten().fieldErrors));
      return;
    }

    const result = await conversationService.listConversationsForProject(
      req.user!.id,
      req.params.projectId,
      parsed.data,
    );
    res.status(200).json({ status: "ok", data: result });
  } catch (err) {
    next(err);
  }
}

export async function getConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await conversationService.getConversationForProject(
      req.user!.id,
      req.params.projectId,
      req.params.id,
    );
    const messages = await messageService.listMessagesForConversation(
      req.user!.id,
      req.params.projectId,
      req.params.id,
    );
    res.status(200).json({ status: "ok", data: { conversation, messages } });
  } catch (err) {
    next(err);
  }
}
