import { test } from "node:test";
import assert from "node:assert/strict";
import { listProjectActivity } from "./activity";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("listProjectActivity: GETs /projects/:id/activity and returns the unwrapped activity array", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      status: "ok",
      data: {
        activity: [
          {
            id: "a1",
            projectId: "project-1",
            taskId: "task-1",
            actorId: "user-1",
            type: "COMMENT_CREATED",
            metadata: { commentId: "c1" },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
  });

  const activity = await listProjectActivity("project-1");

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/projects/project-1/activity");
  assert.equal(capturedInit?.method, "GET");
  assert.deepEqual(activity, [
    {
      id: "a1",
      projectId: "project-1",
      taskId: "task-1",
      actorId: "user-1",
      type: "COMMENT_CREATED",
      metadata: { commentId: "c1" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("listProjectActivity: propagates an ApiError on an error-envelope response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(403, { status: "error", message: "Not a member of this project" }),
  );

  await assert.rejects(
    () => listProjectActivity("project-1"),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Not a member of this project");
      return true;
    },
  );
});
