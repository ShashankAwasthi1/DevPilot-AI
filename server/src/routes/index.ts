import { Router } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);

export default router;
