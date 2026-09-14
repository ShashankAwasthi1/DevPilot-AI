import { Router } from "express";
import { getMe, updateMe } from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { updateProfileSchema } from "../validation/user.validation";

const router = Router();

router.get("/me", requireAuth, getMe);
router.patch("/me", requireAuth, validate(updateProfileSchema), updateMe);

export default router;
