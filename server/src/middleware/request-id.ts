import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Phase 24 Step 1 - request correlation. Mounted as the very first
// middleware in app.ts (before helmet/cors/json/cookieParser/routes), so
// every response - success, 404, or error - carries an X-Request-ID header
// and every downstream handler (including errorHandler.ts) can read
// req.requestId.
//
// Always generated server-side via node:crypto's randomUUID() - never
// trusts or echoes back a client-supplied `X-Request-ID` request header.
// Accepting a client-provided value would let a caller inject an arbitrary
// string into server logs (a log-injection/spoofing risk) and would make
// "this ID uniquely identifies one request our server handled" no longer
// true - the whole point of generating it here.
//
// Synchronous and side-effect-free beyond the one header write and the one
// property assignment - no logging, no I/O, no parsing of the request body
// or any header/cookie value.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}
