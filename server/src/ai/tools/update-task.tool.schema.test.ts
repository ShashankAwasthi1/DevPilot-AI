import { test } from "node:test";
import assert from "node:assert/strict";
import { updateTaskTool } from "./update-task.tool";

test("updateTask schema requires taskId", () => {
  assert.throws(() => updateTaskTool.schema.parse({ title: "Renamed" }));
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "" , title: "Renamed" }));
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", title: "Renamed" }).taskId, "task-1");
});

test("updateTask schema rejects any unknown field (.strict())", () => {
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", title: "X", extraField: "nope" }));
});

test("updateTask schema: a valid partial update (one field) parses", () => {
  const parsed = updateTaskTool.schema.parse({ taskId: "task-1", status: "DONE" });
  assert.equal(parsed.taskId, "task-1");
  assert.equal(parsed.status, "DONE");
});

test("updateTask schema: omitted fields remain undefined, never defaulted", () => {
  const parsed = updateTaskTool.schema.parse({ taskId: "task-1", status: "DONE" });
  assert.equal(parsed.title, undefined);
  assert.equal(parsed.description, undefined);
  assert.equal(parsed.priority, undefined);
  assert.equal(parsed.assigneeId, undefined);
  assert.equal(parsed.dueDate, undefined);
});

test("updateTask schema: title cannot be null, must be 1-200 chars, trimmed", () => {
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", title: null }));
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", title: "" }));
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", title: "a".repeat(201) }));
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", title: "  Renamed  " }).title, "Renamed");
});

test("updateTask schema: description explicit null is preserved (clears the field)", () => {
  const parsed = updateTaskTool.schema.parse({ taskId: "task-1", description: null });
  assert.equal(parsed.description, null);
});

test("updateTask schema: description trims and enforces max 10000", () => {
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", description: "  hi  " }).description, "hi");
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", description: "a".repeat(10001) }));
});

test("updateTask schema: status/priority only accept known enum values", () => {
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", status: "IN_REVIEW" }).status, "IN_REVIEW");
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", status: "BOGUS" }));
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", priority: "URGENT" }).priority, "URGENT");
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", priority: "BOGUS" }));
});

test("updateTask schema: assigneeId explicit null is preserved (unassigns), non-empty string if provided", () => {
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", assigneeId: null }).assigneeId, null);
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", assigneeId: "user-1" }).assigneeId, "user-1");
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", assigneeId: "" }));
});

test("updateTask schema: dueDate explicit null is preserved (clears it), must be a full ISO datetime with offset", () => {
  assert.equal(updateTaskTool.schema.parse({ taskId: "task-1", dueDate: null }).dueDate, null);
  assert.equal(
    updateTaskTool.schema.parse({ taskId: "task-1", dueDate: "2026-03-01T00:00:00Z" }).dueDate,
    "2026-03-01T00:00:00Z",
  );
  // Bare date (no time/offset) must be rejected, matching updateTaskSchema.
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1", dueDate: "2026-03-01" }));
});

test("updateTask schema: rejects an empty/no-op update (taskId alone, nothing to change)", () => {
  assert.throws(() => updateTaskTool.schema.parse({ taskId: "task-1" }));
});
