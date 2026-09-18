import { Router } from "express";
import { login, logout, me, signup } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { loginLimiter, signupLimiter } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { loginSchema, signupSchema } from "../validation/auth.validation";

const router = Router();

router.post("/signup", signupLimiter, validate(signupSchema), signup);
router.post("/login", loginLimiter, validate(loginSchema), login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
