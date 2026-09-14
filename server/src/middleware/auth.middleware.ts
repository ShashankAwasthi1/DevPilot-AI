import { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "../config/auth";
import { getUserForSessionToken } from "../services/auth.service";
import { AppError } from "../utils/AppError";

// Reusable guard for any route that needs an authenticated user - project,
// task, and AI routes in later phases mount this the same way /me does.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE_NAME];

    if (typeof token !== "string" || token.length === 0) {
      throw new AppError(401, "Authentication required");
    }

    const user = await getUserForSessionToken(token);
    if (!user) {
      throw new AppError(401, "Session expired or invalid");
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
