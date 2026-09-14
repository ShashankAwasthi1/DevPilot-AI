import { Router } from "express";
import { createComment, listComments } from "../controllers/comment.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createCommentSchema } from "../validation/comment.validation";

const router = Router();

router.get("/:taskId/comments", requireAuth, listComments);
router.post("/:taskId/comments", requireAuth, validate(createCommentSchema), createComment);

export default router;
