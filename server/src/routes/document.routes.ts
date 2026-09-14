import { Router } from "express";
import {
  archiveDocument,
  createDocument,
  getDocument,
  listDocuments,
  searchDocuments,
  updateDocument,
} from "../controllers/document.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createDocumentSchema, updateDocumentSchema } from "../validation/document.validation";

const router = Router();

router.post("/:projectId/documents", requireAuth, validate(createDocumentSchema), createDocument);
router.get("/:projectId/documents", requireAuth, listDocuments);
// Must be registered before "/:projectId/documents/:id" - otherwise a
// request for "/search" would be captured as :id="search" instead.
router.get("/:projectId/documents/search", requireAuth, searchDocuments);
router.get("/:projectId/documents/:id", requireAuth, getDocument);
router.patch(
  "/:projectId/documents/:id",
  requireAuth,
  validate(updateDocumentSchema),
  updateDocument,
);
router.delete("/:projectId/documents/:id", requireAuth, archiveDocument);

export default router;
