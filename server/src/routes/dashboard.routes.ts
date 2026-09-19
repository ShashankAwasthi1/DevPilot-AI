import { Router } from "express";
import { getDashboardActivity } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { apiLimiter } from "../middleware/rate-limit";

const router = Router();

router.get("/activity", requireAuth, apiLimiter, getDashboardActivity);

export default router;
