import { test } from "node:test";
import assert from "node:assert/strict";
import { getTasksTool } from "./get-tasks.tool";

test("getTasksTool's schema rejects a model-supplied projectId/userId (structural scoping guarantee)", () => {
  // .strict() must reject any unexpected key outright - a model attempting
  // to smuggle a projectId/userId into tool input never gets past this.
  assert.throws(() => getTasksTool.schema.parse({ projectId: "some-other-project", limit: 5 }));
  assert.throws(() => getTasksTool.schema.parse({ userId: "someone-else", limit: 5 }));

  // The legitimate shape still parses fine.
  assert.deepEqual(getTasksTool.schema.parse({ limit: 5 }), { limit: 5 });
  assert.deepEqual(getTasksTool.schema.parse({}), {});
});
