import { Router } from "express";
import authRoutes from "./auth.routes";
import commentRoutes from "./comment.routes";
import conversationRoutes from "./conversation.routes";
import dashboardRoutes from "./dashboard.routes";
import diagnosticsRoutes from "./diagnostics.routes";
import documentRoutes from "./document.routes";
import healthRoutes from "./health.routes";
import notificationRoutes from "./notification.routes";
import projectRoutes from "./project.routes";
import taskRoutes from "./task.routes";
import userRoutes from "./user.routes";

const router = Router();

router.use(healthRoutes);
// TEMPORARY - see diagnostics.controller.ts. Remove once the Prisma/
// Render/Neon TLS investigation concludes.
router.use(diagnosticsRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/projects", projectRoutes);
router.use("/projects", documentRoutes);
router.use("/projects", conversationRoutes);
router.use("/tasks", commentRoutes);
// taskRoutes declares its own full paths (/projects/:projectId/tasks and
// /tasks/:id) rather than a shared prefix - mounted with no prefix here,
// same as healthRoutes. Its /tasks/:id shape can never collide with
// commentRoutes' /tasks/:taskId/comments above - the trailing /comments
// segment means only one of the two patterns can ever match a given
// request, regardless of registration order.
router.use(taskRoutes);
router.use("/notifications", notificationRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
