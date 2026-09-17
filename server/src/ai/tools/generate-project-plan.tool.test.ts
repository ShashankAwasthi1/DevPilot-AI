import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../utils/AppError";

const REAL_PROJECT_ID = "project-1";
const REAL_USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";

// "./generate-project-plan.tool" is only ever evaluated once per resolved
// specifier - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import (same
// module-cache constraint documented throughout this suite, e.g.
// create-task.tool.test.ts). A unique query string per test forces a
// fresh module instance, so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshTool() {
  return import(`./generate-project-plan.tool?test=${importCounter++}`) as Promise<
    typeof import("./generate-project-plan.tool")
  >;
}

interface MockOptions {
  role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  getProjectAccess?: () => Promise<unknown>;
}

function mockModules(t: import("node:test").TestContext, options: MockOptions = {}) {
  const role = options.role ?? "OWNER";
  const pendingActionCreateCalls: unknown[] = [];
  let taskCreateCalled = false;
  let prismaTaskCreateCalled = false;

  t.mock.module("../../services/project.service", {
    namedExports: {
      getProjectAccess:
        options.getProjectAccess ?? (async () => ({ project: { id: REAL_PROJECT_ID }, role })),
      assertRole: (callerRole: string, allowed: string[]) => {
        if (!allowed.includes(callerRole)) {
          throw new AppError(403, "You do not have permission to perform this action");
        }
      },
    },
  });

  // A poison pill: if the tool ever calls the real taskService.createTask
  // (which would write a Task), this makes that failure loud and
  // immediate rather than silently succeeding - the tool must NEVER
  // import or call this.
  t.mock.module("../../services/task.service", {
    namedExports: {
      createTask: async () => {
        taskCreateCalled = true;
        throw new Error("generate-project-plan.tool.ts must never call task.service.createTask directly");
      },
    },
  });

  // Another poison pill, one layer lower - even if something bypassed
  // task.service.ts, a direct prisma.task.create call must also be loud.
  t.mock.module("../../config/prisma", {
    namedExports: {
      prisma: {
        task: {
          create: async () => {
            prismaTaskCreateCalled = true;
            throw new Error("generate-project-plan.tool.ts must never call prisma.task.create directly");
          },
        },
      },
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
          resultTaskIds: [],
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
    wasPrismaTaskCreateCalled: () => prismaTaskCreateCalled,
    pendingActionCreateCalls: () => pendingActionCreateCalls,
  };
}

// Invokes the tool exactly the way tool-loop.ts's executeToolCall really
// does: parse the raw args against the tool's own schema first, then call
// the handler with the parsed result.
async function invoke(
  tool: Awaited<ReturnType<typeof importFreshTool>>["generateProjectPlanTool"],
  rawArgs: unknown,
  ctx: { userId: string; projectId: string; conversationId?: string },
) {
  return tool.handler(tool.schema.parse(rawArgs), ctx);
}

const VALID_PLAN = {
  planTitle: "MVP Launch Plan",
  summary: "Get the SaaS MVP launched.",
  tasks: [
    { tempId: "t1", title: "Set up hosting" },
    { tempId: "t2", title: "Write onboarding emails", priority: "HIGH" },
  ],
};

// --- Role-based authorization ------------------------------------------

for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
  test(`generateProjectPlan: ${role} can propose a plan; a PendingTaskAction is created with the correct fields`, async (t) => {
    const spies = mockModules(t, { role });
    const { generateProjectPlanTool } = await importFreshTool();

    const result = (await invoke(generateProjectPlanTool, VALID_PLAN, {
      userId: REAL_USER_ID,
      projectId: REAL_PROJECT_ID,
      conversationId: CONVERSATION_ID,
    })) as { result: { status: string; actionId: string; summary: string } };

    const calls = spies.pendingActionCreateCalls();
    assert.equal(calls.length, 1, `role ${role} should create exactly one PendingTaskAction`);

    assert.equal(result.result.status, "pending_confirmation");
    assert.equal(result.result.actionId, "action-1");
    assert.match(result.result.summary, /2 tasks/);
  });
}

test("generateProjectPlan: VIEWER cannot propose a plan, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "VIEWER" });
  const { generateProjectPlanTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(generateProjectPlanTool, VALID_PLAN, {
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

test("generateProjectPlan: unauthorized project access (caller not a member) is rejected, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, {
    getProjectAccess: async () => {
      throw new AppError(404, "Project not found");
    },
  });
  const { generateProjectPlanTool } = await importFreshTool();

  await assert.rejects(
    () =>
      invoke(generateProjectPlanTool, VALID_PLAN, {
        userId: REAL_USER_ID,
        projectId: REAL_PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- Persisted proposal shape ---------------------------------------------

test("generateProjectPlan: the persisted action has actionType CREATE_PROJECT_PLAN, taskId null, and proposedInput containing exactly planTitle/summary/tasks", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  const call = spies.pendingActionCreateCalls()[0] as {
    conversationId: string;
    projectId: string;
    userId: string;
    actionType: string;
    taskId: string | undefined;
    proposedInput: Record<string, unknown>;
  };

  assert.equal(call.conversationId, CONVERSATION_ID);
  assert.equal(call.projectId, REAL_PROJECT_ID);
  assert.equal(call.userId, REAL_USER_ID);
  assert.equal(call.actionType, "CREATE_PROJECT_PLAN");
  assert.equal(call.taskId, undefined);

  assert.deepEqual(Object.keys(call.proposedInput).sort(), ["planTitle", "summary", "tasks"]);
  assert.equal(call.proposedInput.planTitle, "MVP Launch Plan");
  assert.equal(call.proposedInput.summary, "Get the SaaS MVP launched.");
  assert.deepEqual(call.proposedInput.tasks, [
    { tempId: "t1", title: "Set up hosting", priority: "MEDIUM" },
    { tempId: "t2", title: "Write onboarding emails", priority: "HIGH" },
  ]);
});

test("generateProjectPlan: an omitted summary is persisted as null, never undefined", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  await invoke(
    generateProjectPlanTool,
    { planTitle: "Plan", tasks: [{ tempId: "t1", title: "Task" }] },
    { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
  );

  const call = spies.pendingActionCreateCalls()[0] as { proposedInput: { summary: unknown } };
  assert.equal(call.proposedInput.summary, null);
});

test("generateProjectPlan: expiresAt is set on the returned action using the existing expiration mechanism (delegated to createPendingTaskAction)", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const result = (await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: { actionId: string } };

  // The tool itself never computes expiresAt - createPendingTaskAction
  // (already tested elsewhere) owns that. This just confirms the tool
  // used the real persistence path (an action id came back) rather than
  // fabricating a result.
  assert.equal(result.result.actionId, "action-1");
});

// --- Model-facing result -----------------------------------------------

test("generateProjectPlan: the model-facing result is pending_confirmation and never contains the full task list", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const result = (await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: Record<string, unknown> };

  assert.equal(result.result.status, "pending_confirmation");
  assert.deepEqual(Object.keys(result.result).sort(), ["actionId", "status", "summary"]);
  assert.ok(!JSON.stringify(result.result).includes("Set up hosting"));
  assert.ok(!JSON.stringify(result.result).includes("tempId"));
});

// --- Never mutates anything --------------------------------------------

test("generateProjectPlan: never calls task.service.createTask or prisma.task.create - only a PendingTaskAction is ever created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(spies.wasTaskCreateCalled(), false);
  assert.equal(spies.wasPrismaTaskCreateCalled(), false);
  assert.equal(spies.pendingActionCreateCalls().length, 1);
});

// --- Invalid input never persists ---------------------------------------

test("generateProjectPlan: a duplicate-tempId plan is rejected by schema validation before the handler ever runs, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [
        { tempId: "t1", title: "Task A" },
        { tempId: "t1", title: "Task B" },
      ],
    }),
  );
  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

test("generateProjectPlan: an over-limit plan is rejected by schema validation before the handler ever runs, and no PendingTaskAction is created", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const tasks = Array.from({ length: 21 }, (_, i) => ({ tempId: `t${i}`, title: `Task ${i}` }));
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks }));
  assert.equal(spies.pendingActionCreateCalls().length, 0);
});

// --- pendingAction (Phase 25 Step 4: SSE/chat-pipeline bridge) -----------

test("generateProjectPlan: the handler's return value includes a pendingAction ref alongside the model-facing result", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const returned = (await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: unknown; pendingAction: Record<string, unknown> };

  assert.deepEqual(Object.keys(returned).sort(), ["pendingAction", "result"]);
  assert.equal(returned.pendingAction.actionType, "CREATE_PROJECT_PLAN");
  assert.equal(returned.pendingAction.actionId, "action-1");
  assert.equal(returned.pendingAction.planTitle, "MVP Launch Plan");
  assert.equal(returned.pendingAction.summary, "Get the SaaS MVP launched.");
  assert.equal(returned.pendingAction.expiresAt, "2026-01-01T00:15:00.000Z");
});

test("generateProjectPlan: pendingAction.tasks mirrors the proposed tasks exactly (tempId/title/description/priority), in proposal order", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const returned = (await invoke(
    generateProjectPlanTool,
    {
      planTitle: "Plan",
      tasks: [
        { tempId: "t1", title: "Set up hosting" },
        { tempId: "t2", title: "Security review", description: "Pass before launch", priority: "URGENT" },
      ],
    },
    { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID, conversationId: CONVERSATION_ID },
  )) as { pendingAction: { tasks: unknown[] } };

  assert.deepEqual(returned.pendingAction.tasks, [
    { tempId: "t1", title: "Set up hosting", description: null, priority: "MEDIUM" },
    { tempId: "t2", title: "Security review", description: "Pass before launch", priority: "URGENT" },
  ]);
});

test("generateProjectPlan: the pendingAction ref never appears in the model-facing result", async (t) => {
  mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  const returned = (await invoke(generateProjectPlanTool, VALID_PLAN, {
    userId: REAL_USER_ID,
    projectId: REAL_PROJECT_ID,
    conversationId: CONVERSATION_ID,
  })) as { result: Record<string, unknown> };

  const serializedModelResult = JSON.stringify(returned.result);
  assert.ok(!serializedModelResult.includes("tempId"));
  assert.ok(!serializedModelResult.includes("planTitle"));
  assert.ok(!serializedModelResult.includes("expiresAt"));
});

test("security: a missing conversationId in ToolContext fails safely rather than creating an orphaned action", async (t) => {
  const spies = mockModules(t, { role: "OWNER" });
  const { generateProjectPlanTool } = await importFreshTool();

  await assert.rejects(() =>
    invoke(generateProjectPlanTool, VALID_PLAN, { userId: REAL_USER_ID, projectId: REAL_PROJECT_ID }),
  );

  assert.equal(spies.pendingActionCreateCalls().length, 0);
});
