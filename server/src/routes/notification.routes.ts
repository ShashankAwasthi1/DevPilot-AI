import { Router } from "express";
import {
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notification.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/", requireAuth, listNotifications);
router.post("/read-all", requireAuth, markAllNotificationsAsRead);
router.patch("/:id/read", requireAuth, markNotificationAsRead);

export default router;
