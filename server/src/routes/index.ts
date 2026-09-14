import { Router } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import userRoutes from "./user.routes";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);

export default router;
