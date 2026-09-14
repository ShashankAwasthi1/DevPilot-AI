import { Router } from "express";
import { getDashboardActivity } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/activity", requireAuth, getDashboardActivity);

export default router;
