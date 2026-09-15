import { Router } from "express";
import { listActivity } from "../controllers/activity.controller";
import { listProjectMembers } from "../controllers/project-member.controller";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "../controllers/project.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createProjectSchema, updateProjectSchema } from "../validation/project.validation";

const router = Router();

router.post("/", requireAuth, validate(createProjectSchema), createProject);
router.get("/", requireAuth, listProjects);
router.get("/:id", requireAuth, getProject);
router.patch("/:id", requireAuth, validate(updateProjectSchema), updateProject);
router.delete("/:id", requireAuth, archiveProject);
router.get("/:id/activity", requireAuth, listActivity);
router.get("/:id/members", requireAuth, listProjectMembers);

export default router;
