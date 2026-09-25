import { getRequiredPublicEnv } from "./env";

// Exported so lib/ai-chat.ts (which needs raw fetch/streaming, not this
// file's JSON-envelope request()) can target the same base URL without
// duplicating the env var/fallback logic.
export const API_URL = getRequiredPublicEnv(
  process.env.NEXT_PUBLIC_API_URL,
  "NEXT_PUBLIC_API_URL",
  "http://localhost:8080/api/v1",
);

// Mirrors the shape every server/src/utils/AppError.ts response takes:
// { status: "ok", data } on success, { status: "error", message, details? }
// on failure.
interface ApiEnvelope<T> {
  status: "ok" | "error";
  data?: T;
  message?: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

// Endpoints where a 401 is an ordinary, expected response - not a signal
// that a previously-valid session just expired mid-use - so a global
// auto-redirect must never fire for them:
// - /auth/login: a 401 here means "wrong email/password," which the login
//   page's own form already displays as an inline error. Redirecting to
//   /login on this would be pointless (already there) and would swallow
//   the actual error message.
// - /auth/signup, /auth/logout: never expected to 401 in normal use, but
//   excluded defensively for the same reason - these are auth actions
//   themselves, not a stand-in for "am I still logged in."
// - /auth/me: the routine "am I logged in" check every authenticated page
//   already performs itself (useApiData("/auth/me") + its own redirect
//   effect, e.g. app/dashboard/page.tsx). Letting this path through here
//   too would race that existing, working per-page handling for no
//   benefit - the real gap this redirect closes is a 401 from any OTHER
//   (data/mutation) request during an already-loaded page.
const AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT = ["/auth/login", "/auth/signup", "/auth/me", "/auth/logout"];

// Guards against firing more than one navigation when several in-flight
// requests all receive a 401 around the same time (e.g. a page firing
// several parallel useApiData calls right as a session expires) - the
// first 401 sets this and redirects; every other request's 401 in the
// same page lifetime just lets its own ApiError propagate normally
// without triggering a second, redundant navigation. Never needs an
// explicit reset: window.location.href below is a full page navigation,
// which tears down and reloads this entire module (and its state) fresh.
let redirectingToLogin = false;

function handleSessionExpired(path: string): void {
  if (AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT.includes(path)) return;
  if (redirectingToLogin) return;
  // This module is only ever imported by "use client" components (never a
  // Server Component or SSR code path), but guarded anyway rather than
  // assumed - both because that could change without this file's own
  // knowledge, and because the plain-Node test environment this project
  // uses (no jsdom/browser globals) has no `window` at all.
  if (typeof window === "undefined") return;
  redirectingToLogin = true;
  window.location.href = "/login";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      // The session cookie is set by the API's own origin (httpOnly), so
      // the browser must be told to attach it on every cross-origin call -
      // this is the one thing that makes the whole auth flow work.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection.");
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!res.ok || !body || body.status === "error") {
    if (res.status === 401) {
      handleSessionExpired(path);
    }
    throw new ApiError(res.status, body?.message ?? "Something went wrong.", body?.details);
  }

  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
