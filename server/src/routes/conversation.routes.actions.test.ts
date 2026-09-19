import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// Same createRequire-based Router introspection as project.routes.members.test.ts/
// task.routes.test.ts - there is no supertest dependency in this repo, and
// this avoids adding one just to check route registration.
const require = Module.createRequire(__filename);

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { name: string }[];
  };
}

function layers(router: unknown): RouteLayer[] {
  return (router as { stack: RouteLayer[] }).stack;
}

test("conversation.routes: POST /:projectId/conversations/:conversationId/actions/:actionId/confirm is registered, requires auth, and has no validate() middleware (no request body)", () => {
  const router = require("./conversation.routes.ts").default;
  const layer = layers(router).find(
    (l) => l.route?.path === "/:projectId/conversations/:conversationId/actions/:actionId/confirm" && l.route.methods.post,
  );

  assert.ok(layer, "confirm route must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  // Phase 16A: apiLimiter (general authenticated-API rate limiter) now
  // runs right after requireAuth - express-rate-limit's returned
  // middleware is anonymous, so it shows up as "<anonymous>" here.
  assert.deepEqual(middlewareNames, ["requireAuth", "<anonymous>", "confirmPendingTaskAction"]);
});

test("conversation.routes: POST /:projectId/conversations/:conversationId/actions/:actionId/cancel is registered, requires auth, and has no validate() middleware (no request body)", () => {
  const router = require("./conversation.routes.ts").default;
  const layer = layers(router).find(
    (l) => l.route?.path === "/:projectId/conversations/:conversationId/actions/:actionId/cancel" && l.route.methods.post,
  );

  assert.ok(layer, "cancel route must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  assert.deepEqual(middlewareNames, ["requireAuth", "<anonymous>", "cancelPendingTaskAction"]);
});
