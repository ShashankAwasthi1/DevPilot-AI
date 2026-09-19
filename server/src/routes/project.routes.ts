import { Router } from "express";
import { listActivity } from "../controllers/activity.controller";
import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from "../controllers/project-member.controller";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "../controllers/project.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { apiLimiter } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from "../validation/project.validation";

const router = Router();

router.post("/", requireAuth, apiLimiter, validate(createProjectSchema), createProject);
router.get("/", requireAuth, apiLimiter, listProjects);
router.get("/:id", requireAuth, apiLimiter, getProject);
router.patch("/:id", requireAuth, apiLimiter, validate(updateProjectSchema), updateProject);
router.delete("/:id", requireAuth, apiLimiter, archiveProject);
router.get("/:id/activity", requireAuth, apiLimiter, listActivity);
router.get("/:id/members", requireAuth, apiLimiter, listProjectMembers);
router.post("/:id/members", requireAuth, apiLimiter, validate(addProjectMemberSchema), addProjectMember);
router.patch(
  "/:id/members/:userId",
  requireAuth,
  apiLimiter,
  validate(updateProjectMemberRoleSchema),
  updateProjectMemberRole,
);
router.delete("/:id/members/:userId", requireAuth, apiLimiter, removeProjectMember);

export default router;
