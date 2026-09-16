import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmPendingTaskAction, cancelPendingTaskAction } from "./pending-actions";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("confirmPendingTaskAction: POSTs to the exact confirm endpoint with no request body, and returns the unwrapped Task", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, {
      status: "ok",
      data: { task: { id: "task-1", projectId: "project-1", title: "Add dark mode support" } },
    });
  });

  const task = await confirmPendingTaskAction("project-1", "conversation-1", "action-1");

  assert.equal(
    String(capturedUrl),
    "http://localhost:8080/api/v1/projects/project-1/conversations/conversation-1/actions/action-1/confirm",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, undefined, "confirm sends no request body");
  assert.deepEqual(task, { id: "task-1", projectId: "project-1", title: "Add dark mode support" });
});

test("confirmPendingTaskAction: propagates an ApiError on a non-2xx/error-envelope response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { status: "error", message: "This proposal is no longer pending" }),
  );

  await assert.rejects(
    () => confirmPendingTaskAction("project-1", "conversation-1", "action-1"),
    (err: unknown) => {
      assert.equal((err as { message: string }).message, "This proposal is no longer pending");
      return true;
    },
  );
});

test("cancelPendingTaskAction: POSTs to the exact cancel endpoint with no request body, and returns the unwrapped cancellation result", async (t) => {
  let capturedUrl: string | URL | undefined;
  let capturedInit: RequestInit | undefined;

  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, { status: "ok", data: { action: { actionId: "action-1", status: "CANCELLED" } } });
  });

  const result = await cancelPendingTaskAction("project-1", "conversation-1", "action-1");

  assert.equal(
    String(capturedUrl),
    "http://localhost:8080/api/v1/projects/project-1/conversations/conversation-1/actions/action-1/cancel",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, undefined, "cancel sends no request body");
  assert.deepEqual(result, { actionId: "action-1", status: "CANCELLED" });
});
