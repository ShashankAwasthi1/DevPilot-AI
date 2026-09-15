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
