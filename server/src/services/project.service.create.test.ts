import { test } from "node:test";
import assert from "node:assert/strict";

test("createProject: successfully creating a project records a PROJECT_CREATED activity, and returns the caller as OWNER", async (t) => {
  let projectCreateData: Record<string, unknown> | undefined;
  let activityCall: { type: string; projectId: string; actorId: string; metadata: unknown } | undefined;

  t.mock.module("./activity.service", {
    namedExports: {
      recordActivity: async (
        _client: unknown,
        args: { type: string; projectId: string; actorId: string; metadata: unknown },
      ) => {
        activityCall = args;
      },
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        project: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            projectCreateData = data;
            return {
              id: "project-new",
              name: data.name,
              description: data.description ?? null,
              ownerId: data.ownerId,
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
      },
    },
  });

  const { createProject } = await import("./project.service");

  const result = await createProject("user-1", { name: "New Project", description: "A description" });

  assert.equal(projectCreateData?.name, "New Project");
  assert.equal(projectCreateData?.ownerId, "user-1");

  assert.ok(activityCall, "recordActivity must be called for a successful project creation");
  assert.equal(activityCall?.type, "PROJECT_CREATED");
  assert.equal(activityCall?.projectId, "project-new");
  assert.equal(activityCall?.actorId, "user-1");
  assert.deepEqual(activityCall?.metadata, { projectId: "project-new", actorId: "user-1" });

  assert.equal(result.id, "project-new");
  assert.equal(result.role, "OWNER");
});
