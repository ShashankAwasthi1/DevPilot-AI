import { Router } from "express";
import {
  createConversation,
  getConversation,
  listConversations,
} from "../controllers/conversation.controller";
import { postMessage } from "../controllers/message.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createConversationSchema, createMessageSchema } from "../validation/conversation.validation";

const router = Router();

router.post(
  "/:projectId/conversations",
  requireAuth,
  validate(createConversationSchema),
  createConversation,
);
router.get("/:projectId/conversations", requireAuth, listConversations);
router.get("/:projectId/conversations/:id", requireAuth, getConversation);
router.post(
  "/:projectId/conversations/:id/messages",
  requireAuth,
  validate(createMessageSchema),
  postMessage,
);

export default router;
