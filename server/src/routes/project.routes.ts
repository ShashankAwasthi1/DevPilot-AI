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
import { validate } from "../middleware/validate";
import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from "../validation/project.validation";

const router = Router();

router.post("/", requireAuth, validate(createProjectSchema), createProject);
router.get("/", requireAuth, listProjects);
router.get("/:id", requireAuth, getProject);
router.patch("/:id", requireAuth, validate(updateProjectSchema), updateProject);
router.delete("/:id", requireAuth, archiveProject);
router.get("/:id/activity", requireAuth, listActivity);
router.get("/:id/members", requireAuth, listProjectMembers);
router.post("/:id/members", requireAuth, validate(addProjectMemberSchema), addProjectMember);
router.patch(
  "/:id/members/:userId",
  requireAuth,
  validate(updateProjectMemberRoleSchema),
  updateProjectMemberRole,
);
router.delete("/:id/members/:userId", requireAuth, removeProjectMember);

export default router;
