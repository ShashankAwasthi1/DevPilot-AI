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
