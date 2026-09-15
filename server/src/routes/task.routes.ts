import { Router } from "express";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "../controllers/task.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createTaskSchema, updateTaskSchema } from "../validation/task.validation";

// Unlike every other feature router, task routes live under two distinct
// base paths - collection operations under /projects/:projectId/tasks,
// item operations under /tasks/:id - so this router declares full,
// absolute-style paths (relative to /api/v1) and is mounted with no
// prefix in routes/index.ts, the same way health.routes.ts is. This keeps
// PATCH/DELETE /tasks/:id from ever needing to be nested three levels
// deep under a project, while still authorizing every operation through
// the task/project id it's actually given (see task.service.ts).
const router = Router();

router.post("/projects/:projectId/tasks", requireAuth, validate(createTaskSchema), createTask);
router.get("/projects/:projectId/tasks", requireAuth, listTasks);
router.get("/tasks/:id", requireAuth, getTask);
router.patch("/tasks/:id", requireAuth, validate(updateTaskSchema), updateTask);
router.delete("/tasks/:id", requireAuth, deleteTask);

export default router;
