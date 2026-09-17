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

  const result = await confirmPendingTaskAction("project-1", "conversation-1", "action-1");

  assert.equal(
    String(capturedUrl),
    "http://localhost:8080/api/v1/projects/project-1/conversations/conversation-1/actions/action-1/confirm",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, undefined, "confirm sends no request body");
  assert.deepEqual(result, {
    kind: "task",
    task: { id: "task-1", projectId: "project-1", title: "Add dark mode support" },
  });
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

// Phase 25 Step 5: the same endpoint/helper now also serves a
// CREATE_PROJECT_PLAN confirmation, whose response shape is
// { data: { tasks } } rather than { data: { task } } (Phase 25 Step 3's
// controller). One request, discriminated by response shape - never one
// request per proposed task.
test("confirmPendingTaskAction: a CREATE_PROJECT_PLAN-shaped { data: { tasks } } response is parsed into the plural discriminated result, from exactly one request", async (t) => {
  let requestCount = 0;
  const createdTasks = [
    { id: "task-1", projectId: "project-1", title: "Set up hosting" },
    { id: "task-2", projectId: "project-1", title: "Write onboarding emails" },
  ];

  t.mock.method(globalThis, "fetch", async () => {
    requestCount += 1;
    return jsonResponse(200, { status: "ok", data: { tasks: createdTasks } });
  });

  const result = await confirmPendingTaskAction("project-1", "conversation-1", "action-1");

  assert.equal(requestCount, 1, "exactly one confirmation request for the entire plan");
  assert.deepEqual(result, { kind: "tasks", tasks: createdTasks });
});

// Same helper, same endpoint, an UPDATE_TASK-shaped response - proves the
// singular { data: { task } } path (already exercised above for
// CREATE_TASK) is not special-cased to CREATE_TASK specifically; both
// existing action types return through the identical `kind: "task"` branch.
test("confirmPendingTaskAction: an UPDATE_TASK-shaped { data: { task } } response is parsed into the singular discriminated result", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      status: "ok",
      data: { task: { id: "task-1", projectId: "project-1", title: "Fix login redirect", status: "DONE" } },
    }),
  );

  const result = await confirmPendingTaskAction("project-1", "conversation-1", "action-1");

  assert.deepEqual(result, {
    kind: "task",
    task: { id: "task-1", projectId: "project-1", title: "Fix login redirect", status: "DONE" },
  });
});

test("confirmPendingTaskAction: an unexpected response shape (neither task nor tasks) throws a safe ApiError rather than resolving", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse(200, { status: "ok", data: {} }));

  await assert.rejects(() => confirmPendingTaskAction("project-1", "conversation-1", "action-1"));
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
