import { Request, Response } from "express";
import { getEmbeddingModelStatus } from "../ai/local-embedding-provider";
import { prisma } from "../config/prisma";

// Liveness only - "the process is up and can respond." Deliberately never
// checks the database, the embedding model, or any other dependency: a
// platform's liveness probe should restart the process only when the
// process itself is wedged, not because one optional feature (RAG) is
// degraded, or because the database is briefly unreachable. See
// getReadiness below for that.
export function getHealth(_req: Request, res: Response) {
  res.status(200).json({
    status: "ok",
    service: "devpilot-api",
  });
}

// Readiness - a genuine dependency check for the database, plus the
// embedding model's load state as a plain, observability-only signal.
// Phase 27 Step 8: only the database check gates the HTTP status code
// (200 healthy, 503 unavailable) - a "failed"/"loading" embedding model
// never does, and never did: it degrades RAG search (fewer/no results)
// but never breaks the rest of the app (auth, projects, tasks, etc.), so
// it stays purely informational here, same as before this step. The
// database check is a single, lightweight `SELECT 1` - no table scan, no
// lock, negligible load even called on every request. On failure, only a
// fixed, generic message is returned - never the underlying Prisma
// error, connection string, host, or any other internal detail (only
// logged server-side via console.error).
export async function getReadiness(_req: Request, res: Response) {
  const embeddingModel = getEmbeddingModelStatus();

  let database: "ok" | "unavailable";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";
  } catch (err) {
    console.error("Readiness check: database query failed:", err instanceof Error ? err.message : err);
    database = "unavailable";
  }

  if (database === "unavailable") {
    res.status(503).json({
      status: "error",
      message: "Not ready: the database is unavailable.",
    });
    return;
  }

  res.status(200).json({
    status: "ok",
    data: { embeddingModel, database },
  });
}
