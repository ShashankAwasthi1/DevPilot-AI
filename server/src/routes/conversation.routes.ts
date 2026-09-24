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
import { aiChatLimiter, apiLimiter, conversationCreationLimiter } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  createConversationSchema,
  createMessageSchema,
  updateConversationSchema,
} from "../validation/conversation.validation";

const router = Router();

// conversationCreationLimiter runs in addition to apiLimiter, not instead
// of it - a tighter, purpose-built budget on top of the general one, same
// pattern as aiChatLimiter's relationship to apiLimiter on other routes
// (see the comment on POST .../messages below). Only this route gets it:
// listing/renaming/deleting a conversation, and posting a message, are
// unaffected.
router.post(
  "/:projectId/conversations",
  requireAuth,
  apiLimiter,
  conversationCreationLimiter,
  validate(createConversationSchema),
  createConversation,
);
router.get("/:projectId/conversations", requireAuth, apiLimiter, listConversations);
router.get("/:projectId/conversations/:id", requireAuth, apiLimiter, getConversation);
router.patch(
  "/:projectId/conversations/:id",
  requireAuth,
  apiLimiter,
  validate(updateConversationSchema),
  updateConversation,
);
router.delete("/:projectId/conversations/:id", requireAuth, apiLimiter, deleteConversation);
// The AI message route intentionally does NOT get apiLimiter - it already
// has its own tighter, purpose-built limiter (aiChatLimiter) bounding LLM
// spend, which must stay the only limiter governing this route rather than
// stacking a second, unrelated quota on top of it.
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
  apiLimiter,
  confirmPendingTaskAction,
);
router.post(
  "/:projectId/conversations/:conversationId/actions/:actionId/cancel",
  requireAuth,
  apiLimiter,
  cancelPendingTaskAction,
);

export default router;
