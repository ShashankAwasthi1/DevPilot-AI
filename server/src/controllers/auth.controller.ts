import { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../config/auth";
import * as authService from "../services/auth.service";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, session } = await authService.signup(req.body);
    res.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
    res.status(201).json({ status: "ok", data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, session } = await authService.login(req.body);
    res.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
    res.status(200).json({ status: "ok", data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token === "string" && token.length > 0) {
      await authService.revokeSession(token);
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: sessionCookieOptions.path });
    res.status(200).json({ status: "ok", data: null });
  } catch (err) {
    next(err);
  }
}

export function me(req: Request, res: Response) {
  res.status(200).json({ status: "ok", data: { user: req.user } });
}
