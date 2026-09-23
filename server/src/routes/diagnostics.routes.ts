import { Router } from "express";
import { getDiagnostics } from "../controllers/diagnostics.controller";

// TEMPORARY - see diagnostics.controller.ts's own top-of-file comment.
// Delete this file and its mount in routes/index.ts once the Prisma/
// Render/Neon TLS investigation concludes.
const router = Router();

router.get("/_diag", getDiagnostics);

export default router;
