import { NextFunction, Request, Response } from "express";
import * as documentService from "../services/document.service";
import { AppError } from "../utils/AppError";
import {
  listDocumentsQuerySchema,
  searchDocumentsQuerySchema,
} from "../validation/document.validation";

export async function createDocument(req: Request, res: Response, next: NextFunction) {
  try {
    // authorId always comes from the verified session, never the body.
    const document = await documentService.createDocument(
      req.user!.id,
      req.params.projectId,
      req.body,
    );
    res.status(201).json({ status: "ok", data: { document } });
  } catch (err) {
    next(err);
  }
}

export async function listDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    // Query params need their own validation - mirrors
    // notification.controller.ts's manual safeParse/AppError(400, ...)
    // shape, since the shared `validate()` middleware only covers req.body.
    const parsed = listDocumentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, "Validation failed", parsed.error.flatten().fieldErrors));
      return;
    }

    const result = await documentService.listDocumentsForProject(
      req.user!.id,
      req.params.projectId,
      parsed.data,
    );
    res.status(200).json({ status: "ok", data: result });
  } catch (err) {
    next(err);
  }
}

export async function searchDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = searchDocumentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, "Validation failed", parsed.error.flatten().fieldErrors));
      return;
    }

    const documents = await documentService.searchDocumentsInProject(
      req.user!.id,
      req.params.projectId,
      parsed.data.q,
    );
    res.status(200).json({ status: "ok", data: { documents } });
  } catch (err) {
    next(err);
  }
}

export async function getDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const document = await documentService.getDocumentForProject(
      req.user!.id,
      req.params.projectId,
      req.params.id,
    );
    res.status(200).json({ status: "ok", data: { document } });
  } catch (err) {
    next(err);
  }
}

export async function updateDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const document = await documentService.updateDocument(
      req.user!.id,
      req.params.projectId,
      req.params.id,
      req.body,
    );
    res.status(200).json({ status: "ok", data: { document } });
  } catch (err) {
    next(err);
  }
}

export async function archiveDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const document = await documentService.archiveDocument(
      req.user!.id,
      req.params.projectId,
      req.params.id,
    );
    res.status(200).json({ status: "ok", data: { document } });
  } catch (err) {
    next(err);
  }
}
