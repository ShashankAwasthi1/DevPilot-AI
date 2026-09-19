import { Router } from "express";
import {
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notification.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { apiLimiter } from "../middleware/rate-limit";

const router = Router();

router.get("/", requireAuth, apiLimiter, listNotifications);
router.post("/read-all", requireAuth, apiLimiter, markAllNotificationsAsRead);
router.patch("/:id/read", requireAuth, apiLimiter, markNotificationAsRead);

export default router;
