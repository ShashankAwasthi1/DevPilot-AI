import { Router } from "express";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../controllers/conversation.controller";
import { postMessage } from "../controllers/message.controller";
import {
  cancelPendingTaskAction,
  confirmPendingTaskAction,
} from "../controllers/pending-task-action.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { aiChatLimiter } from "../middleware/rate-limit";
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
  aiChatLimiter,
  validate(createMessageSchema),
  postMessage,
);
// Three ids in this path (project/conversation/action), so each segment is
// spelled out explicitly rather than reusing the bare ":id" convention the
// two-id routes above use - no body: projectId/conversationId come from
// these route params, userId only from the authenticated session (see
// pending-task-action.controller.ts).
router.post(
  "/:projectId/conversations/:conversationId/actions/:actionId/confirm",
  requireAuth,
  confirmPendingTaskAction,
);
router.post(
  "/:projectId/conversations/:conversationId/actions/:actionId/cancel",
  requireAuth,
  cancelPendingTaskAction,
);

export default router;
