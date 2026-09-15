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

// req.body is already the validated { title } object by the time this
// runs (see conversation.routes.ts's validate(updateConversationSchema)) -
// never re-validated here, and never a source of projectId/userId, which
// come exclusively from the route param and the authenticated session.
export async function updateConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await conversationService.updateConversationTitle(
      req.params.projectId,
      req.params.id,
      req.user!.id,
      req.body,
    );
    res.status(200).json({ status: "ok", data: { conversation } });
  } catch (err) {
    next(err);
  }
}

// Authorization is entirely the service's responsibility (getConversationAccess,
// via deleteConversation) - this controller performs no access checks of its
// own. Responds 200 with an empty data object rather than 204, since the
// client's request() helper (client/lib/api.ts) always attempts to parse a
// JSON envelope from the response body, even for DELETE.
export async function deleteConversation(req: Request, res: Response, next: NextFunction) {
  try {
    await conversationService.deleteConversation(req.params.projectId, req.params.id, req.user!.id);
    res.status(200).json({ status: "ok", data: {} });
  } catch (err) {
    next(err);
  }
}
