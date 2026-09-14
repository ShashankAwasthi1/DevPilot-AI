import { test } from "node:test";
import assert from "node:assert/strict";

test("getTasksTool's handler always scopes the underlying service call to ToolContext, never to anything in args", async (t) => {
  let recordedArgs: unknown[] = [];

  t.mock.module("../../services/task.service", {
    namedExports: {
      listTaskSummariesForProject: async (...args: unknown[]) => {
        recordedArgs = args;
        return [];
      },
    },
  });

  const { getTasksTool } = await import("./get-tasks.tool");

  await getTasksTool.handler({ limit: 3 }, { userId: "u1", projectId: "p1" });

  assert.deepEqual(
    recordedArgs,
    ["u1", "p1", 3],
    "the service must be called with exactly ToolContext's userId/projectId and the parsed limit - nothing from a hypothetical extra args field",
  );
});
