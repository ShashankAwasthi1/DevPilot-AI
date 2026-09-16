import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// Same createRequire-based Router introspection as task.routes.test.ts -
// there is no supertest dependency in this repo, and this avoids adding
// one just to check route registration.
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

test("project.routes: GET /:id/members is registered and requires auth", () => {
  const router = require("./project.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/:id/members" && l.route.methods.get);

  assert.ok(layer, "GET /:id/members must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  assert.deepEqual(middlewareNames, ["requireAuth", "listProjectMembers"]);
});

test("project.routes: POST /:id/members is registered, requires auth, and validates the body", () => {
  const router = require("./project.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/:id/members" && l.route.methods.post);

  assert.ok(layer, "POST /:id/members must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  assert.equal(middlewareNames[0], "requireAuth");
  // validate(addProjectMemberSchema) returns an anonymous arrow function.
  assert.equal(middlewareNames[1], "<anonymous>");
  assert.equal(middlewareNames[2], "addProjectMember");
});

test("project.routes: PATCH /:id/members/:userId is registered, requires auth, and validates the body", () => {
  const router = require("./project.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/:id/members/:userId" && l.route.methods.patch);

  assert.ok(layer, "PATCH /:id/members/:userId must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  assert.equal(middlewareNames[0], "requireAuth");
  // validate(updateProjectMemberRoleSchema) returns an anonymous arrow function.
  assert.equal(middlewareNames[1], "<anonymous>");
  assert.equal(middlewareNames[2], "updateProjectMemberRole");
});

test("project.routes: DELETE /:id/members/:userId is registered and requires auth", () => {
  const router = require("./project.routes.ts").default;
  const layer = layers(router).find((l) => l.route?.path === "/:id/members/:userId" && l.route.methods.delete);

  assert.ok(layer, "DELETE /:id/members/:userId must be registered");
  const middlewareNames = layer!.route!.stack.map((s) => s.name);
  assert.deepEqual(middlewareNames, ["requireAuth", "removeProjectMember"]);
});
