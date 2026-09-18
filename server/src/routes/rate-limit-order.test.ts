import { test } from "node:test";
import assert from "node:assert/strict";
import type { Router } from "express";
import { login, signup } from "../controllers/auth.controller";
import { postMessage } from "../controllers/message.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { aiChatLimiter, loginLimiter, signupLimiter } from "../middleware/rate-limit";
import authRoutes from "./auth.routes";
import conversationRoutes from "./conversation.routes";

// Phase 27 Step 4: a small, dependency-free assertion that the rate limiters
// are actually mounted in the required conceptual order - no HTTP request is
// made and no new test-HTTP-client dependency is introduced. Express's
// Router exposes its registered layers as router.stack; for a routed method
// (post/get/...), layer.route.stack is itself an ordered array of Layers,
// each wrapping the exact middleware/handler function reference passed to
// router.post(...) - so the real imported function references can be
// located by identity, not by fragile name/string matching.

function handlersFor(router: Router, method: string, path: string): unknown[] {
  for (const layer of router.stack as unknown as { route?: { path: string; stack: { method: string; handle: unknown }[] } }[]) {
    if (layer.route?.path === path) {
      return layer.route.stack.filter((l) => l.method === method).map((l) => l.handle);
    }
  }
  throw new Error(`No route registered for ${method.toUpperCase()} ${path}`);
}

test("auth.routes: POST /signup runs signupLimiter before validate/signup, and signupLimiter is the very first handler", () => {
  const handlers = handlersFor(authRoutes, "post", "/signup");

  const limiterIndex = handlers.indexOf(signupLimiter);
  const controllerIndex = handlers.indexOf(signup);

  assert.equal(limiterIndex, 0, "signupLimiter must be the first handler in the chain");
  assert.ok(controllerIndex > limiterIndex, "the signup controller must run after signupLimiter");
});

test("auth.routes: POST /login runs loginLimiter before validate/login, and loginLimiter is the very first handler", () => {
  const handlers = handlersFor(authRoutes, "post", "/login");

  const limiterIndex = handlers.indexOf(loginLimiter);
  const controllerIndex = handlers.indexOf(login);

  assert.equal(limiterIndex, 0, "loginLimiter must be the first handler in the chain");
  assert.ok(controllerIndex > limiterIndex, "the login controller must run after loginLimiter");
});

test("conversation.routes: POST .../messages runs requireAuth, then aiChatLimiter, then the rest of the chain (so aiChatLimiter can read req.user.id)", () => {
  const handlers = handlersFor(conversationRoutes, "post", "/:projectId/conversations/:id/messages");

  const authIndex = handlers.indexOf(requireAuth);
  const limiterIndex = handlers.indexOf(aiChatLimiter);
  const controllerIndex = handlers.indexOf(postMessage);

  assert.notEqual(authIndex, -1, "requireAuth must be present on this route");
  assert.notEqual(limiterIndex, -1, "aiChatLimiter must be present on this route");
  assert.ok(authIndex < limiterIndex, "requireAuth must run before aiChatLimiter, so req.user is populated first");
  assert.ok(limiterIndex < controllerIndex, "aiChatLimiter must run before the message controller");
});
