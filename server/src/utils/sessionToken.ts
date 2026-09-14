import { createHash, randomBytes } from "node:crypto";

// The raw token is only ever handed to the browser (in the cookie).
// Only its hash is stored in the database, so a leaked/dumped Session
// table can never be used to impersonate a user.
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
