import { Router } from "express";
import { createComment, listComments } from "../controllers/comment.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { apiLimiter } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { createCommentSchema } from "../validation/comment.validation";

const router = Router();

router.get("/:taskId/comments", requireAuth, apiLimiter, listComments);
router.post("/:taskId/comments", requireAuth, apiLimiter, validate(createCommentSchema), createComment);

export default router;
