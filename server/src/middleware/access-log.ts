import type { NextFunction, Request, Response } from "express";

// Phase 24 Step 2 - access/latency logging. Mounted immediately after
// request-id.ts (so req.requestId is always already set), before every
// other middleware. Every request - success, 404, or error alike - ends by
// emitting the Node "finish" event on its response, so listening for that
// (rather than wrapping res.json/res.end) is what guarantees exactly one
// log line per request regardless of which downstream handler eventually
// produced the response.
//
// Deliberately minimal: no logging library, no request/response body, no
// query string, no header, no cookie - only the five fields captured below.
// `req.path` (not `req.originalUrl`/`req.url`) is used specifically
// because it's the pathname alone, with the query string already stripped
// by Express - never re-parsed or trimmed by this file itself.
//
// requestId/method/path are all captured NOW, before `next()`, rather than
// read from `req` inside the "finish" listener below - this middleware is
// mounted at the very top of the app, before the "/api/v1" sub-router
// attaches, and Express mutates `req.url` (and therefore `req.path`) while
// dispatching through a mounted sub-router, restoring it only once that
// layer's handler chain completes. By the time "finish" fires, that
// restoration has already happened in a way that is not safe to rely on -
// capturing these three values up front is what actually guarantees the
// full original path is what gets logged.
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const { requestId, method, path } = req;

  res.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    console.log(
      `HTTP request requestId=${requestId} method=${method} path=${path} ` +
        `status=${res.statusCode} durationMs=${durationMs}`,
    );
  });

  next();
}
