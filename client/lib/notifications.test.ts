import { test } from "node:test";
import assert from "node:assert/strict";
import { listNotifications, markAllNotificationsAsRead, markNotificationAsRead } from "./notifications";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("listNotifications: GETs /notifications with no query string when called with no options, and returns the unwrapped result", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      status: "ok",
      data: {
        notifications: [
          { id: "n1", type: "TASK_ASSIGNED", metadata: { taskId: "task-1" }, readAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        unreadCount: 1,
        nextCursor: null,
      },
    });
  });

  const result = await listNotifications();

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/notifications");
  assert.equal(capturedInit?.method, "GET");
  assert.deepEqual(result, {
    notifications: [
      { id: "n1", type: "TASK_ASSIGNED", metadata: { taskId: "task-1" }, readAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    unreadCount: 1,
    nextCursor: null,
  });
});

test("listNotifications: builds the correct query string from limit/cursor/unreadOnly", async (t) => {
  let capturedUrl: string | URL | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    capturedUrl = url;
    return jsonResponse(200, { status: "ok", data: { notifications: [], unreadCount: 0, nextCursor: null } });
  });

  await listNotifications({ limit: 5, cursor: "abc", unreadOnly: true });

  assert.equal(
    String(capturedUrl),
    "http://localhost:8080/api/v1/notifications?limit=5&cursor=abc&unreadOnly=true",
  );
});

test("listNotifications: propagates an ApiError on an error-envelope response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(401, { status: "error", message: "Not authenticated" }));

  await assert.rejects(
    () => listNotifications(),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Not authenticated");
      return true;
    },
  );
});

test("markNotificationAsRead: PATCHes /notifications/:id/read with no body, and returns the unwrapped notification", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      status: "ok",
      data: {
        notification: {
          id: "n1",
          type: "TASK_COMMENT_CREATED",
          metadata: null,
          readAt: "2026-01-01T00:05:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  });

  const notification = await markNotificationAsRead("n1");

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/notifications/n1/read");
  assert.equal(capturedInit?.method, "PATCH");
  assert.equal(capturedInit?.body, undefined, "no request body is sent");
  assert.deepEqual(notification, {
    id: "n1",
    type: "TASK_COMMENT_CREATED",
    metadata: null,
    readAt: "2026-01-01T00:05:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

test("markNotificationAsRead: propagates an ApiError on a not-found response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(404, { status: "error", message: "Notification not found" }));

  await assert.rejects(
    () => markNotificationAsRead("missing"),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Notification not found");
      return true;
    },
  );
});

test("markAllNotificationsAsRead: POSTs to /notifications/read-all with no body, and returns the unwrapped result", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, { status: "ok", data: { updatedCount: 3 } });
  });

  const result = await markAllNotificationsAsRead();

  assert.equal(String(capturedUrl), "http://localhost:8080/api/v1/notifications/read-all");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, undefined, "no request body is sent");
  assert.deepEqual(result, { updatedCount: 3 });
});

test("markAllNotificationsAsRead: propagates an ApiError on an error-envelope response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(401, { status: "error", message: "Not authenticated" }));

  await assert.rejects(
    () => markAllNotificationsAsRead(),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "Not authenticated");
      return true;
    },
  );
});
