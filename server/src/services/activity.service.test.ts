import { test } from "node:test";
import assert from "node:assert/strict";

test("listActivityForProject: omitted limit preserves unbounded ascending behavior; provided limit performs a bounded, deterministic, newest-first DB query", async (t) => {
  const findManyCalls: unknown[] = [];

  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        activity: {
          findMany: async (args: unknown) => {
            findManyCalls.push(args);
            return [];
          },
        },
      },
    },
  });

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
    },
  });

  const { listActivityForProject } = await import("./activity.service");

  // Existing public-contract call shape (activity.controller.ts) - no
  // third argument at all.
  await listActivityForProject("u1", "p1");
  assert.deepEqual(
    findManyCalls[0],
    { where: { projectId: "p1" }, orderBy: { createdAt: "asc" } },
    "omitting limit must reproduce the exact existing unbounded, ascending query - unchanged for the public GET /projects/:id/activity route",
  );

  // New bounded path, used by the AI getActivity tool.
  await listActivityForProject("u1", "p1", 5);
  assert.deepEqual(
    findManyCalls[1],
    {
      where: { projectId: "p1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    },
    "a provided limit must produce a DB-level bounded query, ordered deterministically by createdAt then id, newest first",
  );
});
