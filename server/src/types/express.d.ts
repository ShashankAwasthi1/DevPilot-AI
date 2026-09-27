import type { SafeUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
      // Set unconditionally by middleware/request-id.ts, mounted as the
      // very first thing in app.ts - optional here only because the type
      // itself can't guarantee that middleware ran (same convention as
      // `user` above), not because any code path is expected to see it
      // unset in practice.
      requestId?: string;
    }
  }
}

export {};
