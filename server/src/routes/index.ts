import { Router } from "express";
import authRoutes from "./auth.routes";
import commentRoutes from "./comment.routes";
import documentRoutes from "./document.routes";
import healthRoutes from "./health.routes";
import notificationRoutes from "./notification.routes";
import projectRoutes from "./project.routes";
import userRoutes from "./user.routes";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/projects", projectRoutes);
router.use("/projects", documentRoutes);
router.use("/tasks", commentRoutes);
router.use("/notifications", notificationRoutes);

export default router;
