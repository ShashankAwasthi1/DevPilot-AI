import type { Request } from "express";
import { rateLimit, type Options } from "express-rate-limit";

// Shared JSON error shape for every limiter here, matching errorHandler.ts's
// existing `{status:"error", message}` envelope exactly - rate limiting is
// just another kind of request rejection, not a new response convention.
const RATE_LIMIT_MESSAGE = {
  status: "error",
  message: "Too many requests. Please try again later.",
};

// Fields every limiter below shares: the JSON envelope/status code, and
// standard (RateLimit-*) headers with Retry-After, and the legacy
// (X-RateLimit-*) headers disabled per the current express-rate-limit
// guidance. Each call site still supplies its own windowMs/limit (and, for
// the AI limiter, its own keyGenerator).
const SHARED_OPTIONS: Partial<Options> = {
  statusCode: 429,
  message: RATE_LIMIT_MESSAGE,
  standardHeaders: true,
  legacyHeaders: false,
};

// 5 signups / 15 minutes / IP - generous for a genuine user (nobody signs up
// six times in 15 minutes), low enough to block scripted account creation.
export const signupLimiter = rateLimit({
  ...SHARED_OPTIONS,
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

// 10 logins / 15 minutes / IP - a little more headroom than signup (a real
// user might mistype a password a few times), still far below any useful
// credential-stuffing rate.
export const loginLimiter = rateLimit({
  ...SHARED_OPTIONS,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

// 20 AI chat/agent turns / 5 minutes / authenticated user - bounds per-user
// LLM-provider spend without interrupting a normal back-and-forth
// conversation. Mounted after requireAuth (see conversation.routes.ts), so
// req.user is always populated here; keyed by the user's id rather than IP
// (multiple teammates behind one office IP must not share a budget), with
// no IP fallback - a missing req.user is a middleware-ordering bug, and
// should fail loudly rather than silently degrade to IP-keying.
export const aiChatLimiter = rateLimit({
  ...SHARED_OPTIONS,
  windowMs: 5 * 60 * 1000,
  limit: 20,
  keyGenerator: (req: Request) => req.user!.id,
});

// General limiter for normal, authenticated CRUD/API traffic (projects,
// tasks, documents, comments, notifications, dashboard) - separate from,
// and never a replacement for, the auth-specific and AI-chat limiters
// above. 200 requests / 15 minutes / authenticated user is generous for a
// real user driving the UI (list/create/update calls across several
// screens) while still bounding abuse from a single compromised or
// scripted session. Always mounted after requireAuth on each route (same
// convention as aiChatLimiter), so req.user is guaranteed populated here -
// keyed by user id, never IP, for the same reason aiChatLimiter is: one
// shared office IP must not mean one shared quota. Health/readiness
// routes (health.routes.ts) have no requireAuth and never mount this.
export const apiLimiter = rateLimit({
  ...SHARED_OPTIONS,
  windowMs: 15 * 60 * 1000,
  limit: 200,
  keyGenerator: (req: Request) => req.user!.id,
});

// Phase 22 Step 2: conversation *creation* specifically, on top of (never
// instead of) apiLimiter - a dedicated, tighter budget so a runaway client
// or script can't spam empty Conversation rows even while comfortably
// within the general 200/15min API budget every other project/task/
// document endpoint shares. 30/15min per authenticated user is generous
// for genuine usage (nobody starts 30 new chats in 15 minutes) while
// bounding row growth. Deliberately does NOT gate GET/PATCH/DELETE on
// conversations, or POST .../messages (which already has its own
// purpose-built aiChatLimiter bounding LLM spend) - see
// conversation.routes.ts, where this is mounted only on the creation
// route. Same authenticated-user keying convention as apiLimiter/
// aiChatLimiter - never IP, so one shared office IP never means one
// shared quota.
export const conversationCreationLimiter = rateLimit({
  ...SHARED_OPTIONS,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req: Request) => req.user!.id,
});
