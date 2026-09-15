import { Router } from "express";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../controllers/conversation.controller";
import { postMessage } from "../controllers/message.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createConversationSchema,
  createMessageSchema,
  updateConversationSchema,
} from "../validation/conversation.validation";

const router = Router();

router.post(
  "/:projectId/conversations",
  requireAuth,
  validate(createConversationSchema),
  createConversation,
);
router.get("/:projectId/conversations", requireAuth, listConversations);
router.get("/:projectId/conversations/:id", requireAuth, getConversation);
router.patch(
  "/:projectId/conversations/:id",
  requireAuth,
  validate(updateConversationSchema),
  updateConversation,
);
router.delete("/:projectId/conversations/:id", requireAuth, deleteConversation);
router.post(
  "/:projectId/conversations/:id/messages",
  requireAuth,
  validate(createMessageSchema),
  postMessage,
);

export default router;
