import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// Express Router() instances aren't easily introspected through a plain
// dynamic import in this project's ESM/CJS interop (the router ends up
// wrapped rather than at the top level) - createRequire gives back the
// real Router instance, the same object Express itself would mount, so
// its `.stack` can be inspected directly. There is no existing
// route-level test convention in this repo (no supertest dependency, no
// prior *.routes.test.ts file) - this inspects route registration
// directly instead, without adding a new package.
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

test("task.routes: registers exactly the five expected method+path combinations", () => {
  const router = require("./task.routes.ts").default;
  const routes = layers(router)
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route!.path, methods: Object.keys(layer.route!.methods) }));

  assert.deepEqual(routes, [
    { path: "/projects/:projectId/tasks", methods: ["post"] },
    { path: "/projects/:projectId/tasks", methods: ["get"] },
    { path: "/tasks/:id", methods: ["get"] },
    { path: "/tasks/:id", methods: ["patch"] },
    { path: "/tasks/:id", methods: ["delete"] },
  ]);
});

test("task.routes: GET /tasks/:id requires auth and has no body-validation middleware", () => {
  const router = require("./task.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/tasks/:id" && l.route.methods.get);
  const middlewareNames = layer!.route!.stack.map((s) => s.name);

  // Phase 16A: apiLimiter (a general authenticated-API rate limiter) now
  // runs right after requireAuth on every route here - express-rate-limit
  // returns an anonymous middleware function, so it shows up as
  // "<anonymous>" here, same as validate(...)'s anonymous arrow function.
  assert.deepEqual(middlewareNames, ["requireAuth", "<anonymous>", "getTask"]);
});

test("task.routes: POST /projects/:projectId/tasks requires auth and runs create validation before the controller", () => {
  const router = require("./task.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/projects/:projectId/tasks" && l.route.methods.post);
  const middlewareNames = layer!.route!.stack.map((s) => s.name);

  assert.equal(middlewareNames[0], "requireAuth");
  // apiLimiter, then validate(createTaskSchema) - both anonymous.
  assert.equal(middlewareNames[1], "<anonymous>");
  assert.equal(middlewareNames[2], "<anonymous>");
  assert.equal(middlewareNames[3], "createTask");
});

test("task.routes: GET /projects/:projectId/tasks requires auth", () => {
  const router = require("./task.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/projects/:projectId/tasks" && l.route.methods.get);
  const middlewareNames = layer!.route!.stack.map((s) => s.name);

  assert.deepEqual(middlewareNames, ["requireAuth", "<anonymous>", "listTasks"]);
});

test("task.routes: PATCH /tasks/:id requires auth and runs update validation before the controller", () => {
  const router = require("./task.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/tasks/:id" && l.route.methods.patch);
  const middlewareNames = layer!.route!.stack.map((s) => s.name);

  assert.equal(middlewareNames[0], "requireAuth");
  assert.equal(middlewareNames[1], "<anonymous>");
  assert.equal(middlewareNames[2], "<anonymous>");
  assert.equal(middlewareNames[3], "updateTask");
});

test("task.routes: DELETE /tasks/:id requires auth", () => {
  const router = require("./task.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/tasks/:id" && l.route.methods.delete);
  const middlewareNames = layer!.route!.stack.map((s) => s.name);

  assert.deepEqual(middlewareNames, ["requireAuth", "<anonymous>", "deleteTask"]);
});

test("task.routes: /tasks/:id can never collide with comment.routes' /:taskId/comments, regardless of mount order", () => {
  const taskRouter = require("./task.routes.ts").default;
  const commentRouter = require("./comment.routes.ts").default;

  const taskPaths = layers(taskRouter)
    .filter((l) => l.route)
    .map((l) => l.route!.path);
  const commentPaths = layers(commentRouter)
    .filter((l) => l.route)
    .map((l) => l.route!.path);

  // comment.routes.ts is mounted under /tasks, so its full paths become
  // /tasks/:taskId/comments - a 3-segment path that requires a trailing
  // /comments literal, which /tasks/:id (2 segments, no such literal) can
  // never match and vice versa.
  assert.deepEqual(commentPaths, ["/:taskId/comments", "/:taskId/comments"]);
  assert.ok(taskPaths.includes("/tasks/:id"));
  assert.ok(!commentPaths.some((p) => `/tasks${p}` === "/tasks/:id"));
});
