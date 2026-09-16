import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskComment, listTaskComments } from "./comments";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("listTaskComments: GETs /tasks/:taskId/comments (no projectId segment) and returns the unwrapped comments array", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      status: "ok",
      data: {
        comments: [
          { id: "c1", taskId: "task-1", authorId: "user-1", body: "First", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });
  });

  const comments = await listTaskComments("task-1");

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/tasks/task-1/comments");
  assert.equal(capturedInit?.method, "GET");
  assert.deepEqual(comments, [
    { id: "c1", taskId: "task-1", authorId: "user-1", body: "First", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
});

test("listTaskComments: propagates an ApiError on an error-envelope response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(404, { status: "error", message: "Task not found" }));

  await assert.rejects(
    () => listTaskComments("missing-task"),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Task not found");
      return true;
    },
  );
});

test("createTaskComment: POSTs { body } to /tasks/:taskId/comments and returns the unwrapped created comment", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(201, {
      status: "ok",
      data: {
        comment: {
          id: "c2",
          taskId: "task-1",
          authorId: "user-1",
          body: "New comment",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  });

  const comment = await createTaskComment("task-1", "New comment");

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/tasks/task-1/comments");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, JSON.stringify({ body: "New comment" }));
  assert.deepEqual(comment, {
    id: "c2",
    taskId: "task-1",
    authorId: "user-1",
    body: "New comment",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});

test("createTaskComment: propagates an ApiError on a validation failure response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(400, { status: "error", message: "Invalid request body" }),
  );

  await assert.rejects(
    () => createTaskComment("task-1", ""),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Invalid request body");
      return true;
    },
  );
});
