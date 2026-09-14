import { CookieOptions } from "express";
import { env } from "./env";

export const SESSION_COOKIE_NAME = "devpilot_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const isProduction = env.nodeEnv === "production";

// In production the client and API are on different domains, so the
// cookie must be SameSite=None (and therefore Secure). In local dev
// they're both on localhost (just different ports), where Lax already
// works and doesn't require HTTPS.
export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
  maxAge: SESSION_TTL_MS,
};
