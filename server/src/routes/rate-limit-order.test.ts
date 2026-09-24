import { test } from "node:test";
import assert from "node:assert/strict";
import type { Router } from "express";
import { login, signup } from "../controllers/auth.controller";
import { postMessage } from "../controllers/message.controller";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../controllers/conversation.controller";
import { requireAuth } from "../middleware/auth.middleware";
import {
  aiChatLimiter,
  apiLimiter,
  conversationCreationLimiter,
  loginLimiter,
  signupLimiter,
} from "../middleware/rate-limit";
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

// Express creates a SEPARATE router.stack layer for each router.METHOD(path,
// ...) call, even when several methods share the exact same path string
// (e.g. GET/PATCH/DELETE all on "/:projectId/conversations/:id") - so the
// first layer whose `.path` matches is not necessarily the one for the
// requested method. Every matching-path layer's stack must be checked and
// only used once it actually contains an entry for `method`, rather than
// returning (or filtering down to an empty array) on the very first
// path match found.
function handlersFor(router: Router, method: string, path: string): unknown[] {
  for (const layer of router.stack as unknown as { route?: { path: string; stack: { method: string; handle: unknown }[] } }[]) {
    if (layer.route?.path === path) {
      const matches = layer.route.stack.filter((l) => l.method === method);
      if (matches.length > 0) {
        return matches.map((l) => l.handle);
      }
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

// Phase 22 Step 2: conversation creation gets a dedicated, tighter limiter
// on top of (never instead of) apiLimiter - these tests pin both the exact
// ordering on the creation route and that every other conversation route
// (including message posting, which keeps its own separate aiChatLimiter)
// is entirely unaffected by the new limiter.

test("conversation.routes: POST /:projectId/conversations runs requireAuth, then apiLimiter, then conversationCreationLimiter, then the controller", () => {
  const handlers = handlersFor(conversationRoutes, "post", "/:projectId/conversations");

  const authIndex = handlers.indexOf(requireAuth);
  const apiLimiterIndex = handlers.indexOf(apiLimiter);
  const creationLimiterIndex = handlers.indexOf(conversationCreationLimiter);
  const controllerIndex = handlers.indexOf(createConversation);

  assert.notEqual(authIndex, -1, "requireAuth must be present on this route");
  assert.notEqual(apiLimiterIndex, -1, "apiLimiter must still be present on this route");
  assert.notEqual(creationLimiterIndex, -1, "conversationCreationLimiter must be present on this route");
  assert.ok(authIndex < apiLimiterIndex, "requireAuth must run before apiLimiter");
  assert.ok(apiLimiterIndex < creationLimiterIndex, "apiLimiter must run before conversationCreationLimiter");
  assert.ok(creationLimiterIndex < controllerIndex, "conversationCreationLimiter must run before the controller");
});

test("conversation.routes: conversationCreationLimiter is NOT applied to list/get/update/delete conversation routes", () => {
  const listHandlers = handlersFor(conversationRoutes, "get", "/:projectId/conversations");
  const getHandlers = handlersFor(conversationRoutes, "get", "/:projectId/conversations/:id");
  const patchHandlers = handlersFor(conversationRoutes, "patch", "/:projectId/conversations/:id");
  const deleteHandlers = handlersFor(conversationRoutes, "delete", "/:projectId/conversations/:id");

  assert.equal(listHandlers.indexOf(conversationCreationLimiter), -1);
  assert.equal(getHandlers.indexOf(conversationCreationLimiter), -1);
  assert.equal(patchHandlers.indexOf(conversationCreationLimiter), -1);
  assert.equal(deleteHandlers.indexOf(conversationCreationLimiter), -1);

  // And each of these still carries the unaffected, pre-existing controller
  // reference, confirming this test isn't just checking an empty/broken route.
  assert.notEqual(listHandlers.indexOf(listConversations), -1);
  assert.notEqual(getHandlers.indexOf(getConversation), -1);
  assert.notEqual(patchHandlers.indexOf(updateConversation), -1);
  assert.notEqual(deleteHandlers.indexOf(deleteConversation), -1);
});

test("conversation.routes: POST .../messages remains governed only by aiChatLimiter, never conversationCreationLimiter", () => {
  const handlers = handlersFor(conversationRoutes, "post", "/:projectId/conversations/:id/messages");

  assert.notEqual(handlers.indexOf(aiChatLimiter), -1, "aiChatLimiter must still govern the message route");
  assert.equal(
    handlers.indexOf(conversationCreationLimiter),
    -1,
    "conversationCreationLimiter must never be applied to the message route",
  );
});
