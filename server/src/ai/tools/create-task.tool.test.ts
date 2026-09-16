import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";
const OUTSIDER_ID = "outsider-1";

// "./create-task.tool" is only ever evaluated once per resolved specifier -
// a later t.mock.module call does not retroactively change the bindings a
// module already captured on its first import (same module-cache
// constraint documented throughout this test suite, e.g.
// project-member.service.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshTool() {
  return import(`./create-task.tool?test=${importCounter++}`) as Promise<typeof import("./create-task.tool")>;
}

interface MockOptions {
  role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  ownerId?: string;
  members?: { userId: string; name: string | null; email: string; role: string }[];
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const ownerId = options.ownerId ?? OWNER_ID;
  const role = options.role ?? "OWNER";
  const pendingActionCreateCalls: unknown[] = [];
  let taskCreateCalled = false;

  t.mock.module("../../services/project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { id: REAL_PROJECT_ID, ownerId }, role }),
      assertRole: (callerRole: string, allowed: string[]) => {
        if (!allowed.includes(callerRole)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  t.mock.module("../../services/task.service", {
    namedExports: {
      // A poison pill: if the tool ever calls the real createTask (which
      // would write a Task), this makes that failure loud and immediate
      // rather than silently succeeding - the tool must NEVER import or
      // call this.
      createTask: async () => {
        taskCreateCalled = true;
        throw new Error("createTask.tool.ts must never call task.service.createTask directly");
      },
      assertAssigneeIsProjectMember: async (_projectId: string, assigneeId: string) => {
        if (assigneeId === ownerId) return;
        const isMember = (options.members ?? []).some((m) => m.userId === assigneeId && m.userId !== ownerId);
        if (!isMember) {
          throw new AppError(400, "assigneeId must be a member of this project");
        }
      },
    },
  });

  t.mock.module("../../services/project-member.service", {
    namedExports: {
      listProjectMembers: async () => options.members ?? [],
    },
  });

  t.mock.module("../../services/pending-task-action.service", {
    namedExports: {
      createPendingTaskAction: async (args: unknown) => {
        pendingActionCreateCalls.push(args);
        return {
          id: "action-1",
          ...(args as object),
          status: "PENDING",
          resultTaskId: null,
          resultError: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-01T00:15:00.000Z"),
          confirmedAt: null,
        };
      },
    },
  });

  return {
    wasTaskCreateCalled: () => taskCreateCalled,
    pendingActionCreateCalls: () => pendingActionCreateCalls,
  };
}

// Invokes the tool exactly the way tool-loop.ts's executeToolCall really
// does: parse the raw (possibly partial) args against the tool's own
// schema first (filling defaults, applying trimming), then call the
// handler with the parsed result - never the raw object directly, which
// would bypass status/priority's defaulting.
async function invoke(
  tool: Awaited<ReturnType<typeof importFreshTool>>["createTaskTool"],
  rawArgs: unknown,
  ctx: { userId: string; projectId: string; conversationId?: string },
) {
  return tool.handler(tool.schema.parse(rawArgs), ctx);
}

// --- A. Valid proposal ----------------------------------------------------

for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
  test(`createTask: ${role} can propose a task; a PendingTaskAction is created with the correct fields`, async (t) => {
    const spies = mockModules(t, { role });
    const { createTaskTool } = await importFreshTool();

    const result = (await invoke(
      createTaskTool,
      { title: "Add dark mode support", status: "TODO", priority: "MEDIUM" },
      { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
    )) as { result: { status: string; actionId: string; summary: string }; pendingAction: unknown };

    const calls = spies.pendingActionCreateCalls();
    assert.equal(calls.length, 1, `role ${role} should create exactly one PendingTaskAction`);
    const call = calls[0] as {
      conversationId: string;
      projectId: string;
      userId: string;
      proposedInput: { title: string };
    };
    assert.equal(call.conversationId, CONVERSATION_ID);
    assert.equal(call.projectId, REAL_PROJECT_ID);
    assert.equal(call.userId, REAL_USER_ID);
    assert.equal(call.proposedInput.title, "Add dark mode support");

    assert.equal(result.result.status, "pending_confirmation");
    assert.equal(result.result.actionId, "action-1");
    assert.match(result.result.summary, /Add dark mode support/);
  });
}

// --- C. VIEWER cannot propose ----------------------------------------------

test("createTask: VIEWER cannot propose a task, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "VIEWER" });
  const { createTaskTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(createTaskTool, { title: "Task" }, {
        userId: REAL_USER_ID,
        projectId: REAL_PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    },
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- D. Cross-project isolation --------------------------------------------

test("createTask: the stored projectId always comes from ToolContext, never from anywhere else (schema has no projectId field at all)", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { createTaskTool } = await importFreshTool();

  await invoke(createTaskTool, { title: "Task" }, {
    userId: REAL_USER_ID,
    projectId: "the-real-scoped-project",
    conversationId: CONVERSATION_ID,
  });

  const call = spies.pendingActionCreateCalls()[0] as { projectId: string };
  assert.equal(call.projectId, "the-real-scoped-project");
});

// --- E. Invalid assignee -----------------------------------------------------

test("createTask: an assigneeId that is not a project member is rejected, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "OWNER", members: [] });
  const { createTaskTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(createTaskTool, { title: "Task", assigneeId: OUTSIDER_ID }, {
        userId: REAL_USER_ID,
        projectId: REAL_PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- F. Valid project-owner assignee ----------------------------------------

test("createTask: the project owner (no ProjectMember row) is accepted as assignee, and their name is resolved", async (t) => {
  const spies = mockModules(t, {
    role: "OWNER",
    members: [{ userId: OWNER_ID, name: "Olivia Owner", email: "olivia@example.com", role: "OWNER" }],
  });
  const { createTaskTool } = await importFreshTool();

  const result = (await invoke(createTaskTool, { title: "Task", assigneeId: OWNER_ID }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { pendingAction: { assigneeId: string; assigneeName: string } };

  assert.equal(spies.pendingActionCreateCalls().length, 1);
  assert.equal(result.pendingAction.assigneeId, OWNER_ID);
  assert.equal(result.pendingAction.assigneeName, "Olivia Owner");
});

test("createTask: a real project member is accepted as assignee, and their name/email is resolved", async (t) => {
  mockModules(t, {
    role: "OWNER",
    members: [
      { userId: OWNER_ID, name: "Olivia Owner", email: "olivia@example.com", role: "OWNER" },
      { userId: MEMBER_ID, name: null, email: "mira@example.com", role: "MEMBER" },
    ],
  });
  const { createTaskTool } = await importFreshTool();

  const result = (await invoke(createTaskTool, { title: "Task", assigneeId: MEMBER_ID }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { pendingAction: { assigneeId: string; assigneeName: string } };

  assert.equal(result.pendingAction.assigneeId, MEMBER_ID);
  // No name on this member row - falls back to email, same convention as
  // task.service.ts's listTaskSummariesForProject.
  assert.equal(result.pendingAction.assigneeName, "mira@example.com");
});

// --- G. Nullable/optional fields --------------------------------------------

test("createTask: nullable/optional fields (description, assigneeId, dueDate) are preserved exactly as provided", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { createTaskTool } = await importFreshTool();

  await invoke(createTaskTool, { title: "Task", description: null, assigneeId: null, dueDate: null }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });
  let call = spies.pendingActionCreateCalls()[0] as { proposedInput: Record<string, unknown> };
  assert.equal(call.proposedInput.description, null);
  assert.equal(call.proposedInput.assigneeId, null);
  assert.equal(call.proposedInput.dueDate, null);

  await invoke(createTaskTool, { title: "Task" }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });
  call = spies.pendingActionCreateCalls()[1] as { proposedInput: Record<string, unknown> };
  assert.equal(call.proposedInput.description, undefined);
  assert.equal(call.proposedInput.assigneeId, undefined);
  assert.equal(call.proposedInput.dueDate, undefined);
});

// --- J. Tool cannot create a Task -------------------------------------------

test("createTask: never calls task.service.createTask - only a PendingTaskAction is ever created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { createTaskTool } = await importFreshTool();

  await invoke(createTaskTool, { title: "Task" }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(spies.wasTaskCreateCalled(), false);
  assert.equal(spies.pendingActionCreateCalls().length, 1);
});

// --- Security: model-facing result never leaks internals --------------------

test("security: the model-facing result contains no task id, user id, or raw pendingAction fields", async (t) => {
  mockModules(t, {
    role: "OWNER",
    members: [{ userId: MEMBER_ID, name: "Mira Member", email: "mira@example.com", role: "MEMBER" }],
  });
  const { createTaskTool } = await importFreshTool();

  const result = (await invoke(createTaskTool, { title: "Task", assigneeId: MEMBER_ID }, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: Record<string, unknown> };

  assert.deepEqual(Object.keys(result.result).sort(), ["actionId", "status", "summary"]);
  assert.equal(result.result.status, "pending_confirmation");
  // No userId/assigneeId/projectId anywhere in the model-facing object.
  assert.ok(!JSON.stringify(result.result).includes(REAL_USER_ID));
  assert.ok(!JSON.stringify(result.result).includes(MEMBER_ID));
});

test("security: a missing conversationId in ToolContext fails safely rather than creating an orphaned action", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { createTaskTool } = await importFreshTool();

  await assert.rejects(() =>
    invoke(createTaskTool, { title: "Task" }, { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID }),
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});
