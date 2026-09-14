import { Router } from "express";
import authRoutes from "./auth.routes";
import commentRoutes from "./comment.routes";
import healthRoutes from "./health.routes";
import projectRoutes from "./project.routes";
import userRoutes from "./user.routes";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/projects", projectRoutes);
router.use("/tasks", commentRoutes);

export default router;
