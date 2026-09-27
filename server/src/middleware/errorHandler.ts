import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";

// Phase 24 Step 1: `req` is now read (no longer `_req`) for exactly one
// purpose - req.requestId, set by middleware/request-id.ts (mounted first
// in app.ts, so it's always present by the time an error reaches here).
// Included in both log branches below so two concurrent requests that both
// fail can be told apart in server logs; never included in - and never
// changes - either response's client-facing body, which stays byte-for-byte
// identical to before this step.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof AppError) {
    console.error(`[${err.statusCode}] ${err.message} (requestId=${requestId})`);
    res.status(err.statusCode).json({
      status: "error",
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Still the full raw error object - unchanged from before this step -
  // with the request ID logged alongside it as separate, clearly-labeled
  // context rather than folded into a string (so the raw error's own
  // shape/stack is never altered or truncated to make room for it).
  console.error(`Unexpected error (requestId=${requestId}):`, err);

  res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
}
