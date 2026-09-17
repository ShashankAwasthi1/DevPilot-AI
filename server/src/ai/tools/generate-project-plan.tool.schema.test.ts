import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProjectPlanTool } from "./generate-project-plan.tool";

const ONE_TASK = { tempId: "t1", title: "Set up hosting" };

test("generateProjectPlan schema: a valid single-task plan parses", () => {
  const parsed = generateProjectPlanTool.schema.parse({
    planTitle: "MVP Launch Plan",
    tasks: [ONE_TASK],
  });
  assert.equal(parsed.planTitle, "MVP Launch Plan");
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].title, "Set up hosting");
});

test("generateProjectPlan schema: a valid multi-task plan parses", () => {
  const parsed = generateProjectPlanTool.schema.parse({
    planTitle: "MVP Launch Plan",
    summary: "Get the SaaS MVP launched.",
    tasks: [
      { tempId: "t1", title: "Set up hosting" },
      { tempId: "t2", title: "Write onboarding emails", priority: "HIGH" },
      { tempId: "t3", title: "Security review", description: "Pass before launch" },
    ],
  });
  assert.equal(parsed.tasks.length, 3);
  assert.equal(parsed.tasks[1].priority, "HIGH");
  assert.equal(parsed.tasks[2].description, "Pass before launch");
});

test("generateProjectPlan schema: an empty tasks array is rejected", () => {
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [] }));
});

test("generateProjectPlan schema: more than MAX_PLAN_TASKS tasks is rejected", () => {
  const tasks = Array.from({ length: 21 }, (_, i) => ({ tempId: `t${i}`, title: `Task ${i}` }));
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks }));
});

test("generateProjectPlan schema: exactly MAX_PLAN_TASKS tasks is accepted", () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ tempId: `t${i}`, title: `Task ${i}` }));
  const parsed = generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks });
  assert.equal(parsed.tasks.length, 20);
});

test("generateProjectPlan schema: missing planTitle is rejected", () => {
  assert.throws(() => generateProjectPlanTool.schema.parse({ tasks: [ONE_TASK] }));
});

test("generateProjectPlan schema: empty planTitle (after trim) is rejected", () => {
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "   ", tasks: [ONE_TASK] }));
});

test("generateProjectPlan schema: missing task title is rejected", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [{ tempId: "t1" }] }),
  );
});

test("generateProjectPlan schema: missing tempId is rejected", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [{ title: "Task" }] }),
  );
});

test("generateProjectPlan schema: unknown top-level fields are rejected (.strict())", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [ONE_TASK], projectId: "sneaky" }),
  );
});

test("generateProjectPlan schema: unknown task-level fields are rejected (.strict())", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [{ ...ONE_TASK, assigneeId: "user-1" }],
    }),
  );
});

test("generateProjectPlan schema: duplicate tempId values are rejected", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [
        { tempId: "t1", title: "Task A" },
        { tempId: "t1", title: "Task B" },
      ],
    }),
  );
});

test("generateProjectPlan schema: duplicate titles across tasks are allowed", () => {
  const parsed = generateProjectPlanTool.schema.parse({
    planTitle: "Plan",
    tasks: [
      { tempId: "t1", title: "Write tests" },
      { tempId: "t2", title: "Write tests" },
    ],
  });
  assert.equal(parsed.tasks.length, 2);
});

test("generateProjectPlan schema: nullable description is accepted, omitted stays undefined", () => {
  const withNull = generateProjectPlanTool.schema.parse({
    planTitle: "Plan",
    tasks: [{ ...ONE_TASK, description: null }],
  });
  assert.equal(withNull.tasks[0].description, null);

  const omitted = generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [ONE_TASK] });
  assert.equal(omitted.tasks[0].description, undefined);
});

test("generateProjectPlan schema: summary is nullable/optional", () => {
  assert.equal(
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", summary: null, tasks: [ONE_TASK] }).summary,
    null,
  );
  assert.equal(
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [ONE_TASK] }).summary,
    undefined,
  );
});

test("generateProjectPlan schema: priority defaults to MEDIUM and only accepts known enum values", () => {
  const parsed = generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [ONE_TASK] });
  assert.equal(parsed.tasks[0].priority, "MEDIUM");

  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [{ ...ONE_TASK, priority: "BOGUS" }],
    }),
  );
});

test("generateProjectPlan schema: tempId length is bounded (1-20)", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [{ ...ONE_TASK, tempId: "" }] }),
  );
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [{ ...ONE_TASK, tempId: "a".repeat(21) }],
    }),
  );
  const parsed = generateProjectPlanTool.schema.parse({
    planTitle: "Plan",
    tasks: [{ ...ONE_TASK, tempId: "a".repeat(20) }],
  });
  assert.equal(parsed.tasks[0].tempId.length, 20);
});

test("generateProjectPlan schema: task title length is bounded (1-200)", () => {
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({ planTitle: "Plan", tasks: [{ ...ONE_TASK, title: "" }] }),
  );
  assert.throws(() =>
    generateProjectPlanTool.schema.parse({
      planTitle: "Plan",
      tasks: [{ ...ONE_TASK, title: "a".repeat(201) }],
    }),
  );
  const parsed = generateProjectPlanTool.schema.parse({
    planTitle: "Plan",
    tasks: [{ ...ONE_TASK, title: "a".repeat(200) }],
  });
  assert.equal(parsed.tasks[0].title.length, 200);
});

test("generateProjectPlan schema: planTitle length is bounded (1-200)", () => {
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "a".repeat(201), tasks: [ONE_TASK] }));
  assert.throws(() => generateProjectPlanTool.schema.parse({ planTitle: "", tasks: [ONE_TASK] }));
});
