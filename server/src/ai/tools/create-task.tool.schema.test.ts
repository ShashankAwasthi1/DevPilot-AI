import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskTool } from "./create-task.tool";

test("createTask schema rejects model-supplied projectId/userId/createdById (structural scoping guarantee)", () => {
  assert.throws(() => createTaskTool.schema.parse({ title: "Test", projectId: "malicious-project-id" }));
  assert.throws(() => createTaskTool.schema.parse({ title: "Test", userId: "someone-else" }));
  assert.throws(() => createTaskTool.schema.parse({ title: "Test", createdById: "someone-else" }));
});

test("createTask schema rejects any other unknown field (.strict())", () => {
  assert.throws(() => createTaskTool.schema.parse({ title: "Test", extraField: "nope" }));
});

test("createTask schema enforces title bounds (1-200) and trims", () => {
  assert.throws(() => createTaskTool.schema.parse({ title: "" }));
  assert.throws(() => createTaskTool.schema.parse({ title: "   " }));
  assert.throws(() => createTaskTool.schema.parse({ title: "a".repeat(201) }));
  assert.equal(createTaskTool.schema.parse({ title: "  Ship it  " }).title, "Ship it");
  assert.equal(createTaskTool.schema.parse({ title: "a".repeat(200) }).title.length, 200);
});

test("createTask schema requires title", () => {
  assert.throws(() => createTaskTool.schema.parse({}));
});

test("createTask schema: description is optional, nullable, trimmed, max 10000", () => {
  assert.equal(createTaskTool.schema.parse({ title: "T" }).description, undefined);
  assert.equal(createTaskTool.schema.parse({ title: "T", description: null }).description, null);
  assert.equal(createTaskTool.schema.parse({ title: "T", description: "  hi  " }).description, "hi");
  assert.throws(() => createTaskTool.schema.parse({ title: "T", description: "a".repeat(10001) }));
});

test("createTask schema: status defaults to TODO and only accepts known enum values", () => {
  assert.equal(createTaskTool.schema.parse({ title: "T" }).status, "TODO");
  assert.equal(createTaskTool.schema.parse({ title: "T", status: "IN_REVIEW" }).status, "IN_REVIEW");
  assert.throws(() => createTaskTool.schema.parse({ title: "T", status: "BOGUS" }));
});

test("createTask schema: priority defaults to MEDIUM and only accepts known enum values", () => {
  assert.equal(createTaskTool.schema.parse({ title: "T" }).priority, "MEDIUM");
  assert.equal(createTaskTool.schema.parse({ title: "T", priority: "URGENT" }).priority, "URGENT");
  assert.throws(() => createTaskTool.schema.parse({ title: "T", priority: "BOGUS" }));
});

test("createTask schema: assigneeId is optional, nullable, non-empty if provided", () => {
  assert.equal(createTaskTool.schema.parse({ title: "T" }).assigneeId, undefined);
  assert.equal(createTaskTool.schema.parse({ title: "T", assigneeId: null }).assigneeId, null);
  assert.equal(createTaskTool.schema.parse({ title: "T", assigneeId: "user-1" }).assigneeId, "user-1");
  assert.throws(() => createTaskTool.schema.parse({ title: "T", assigneeId: "" }));
});

test("createTask schema: dueDate is optional, nullable, must be a full ISO datetime with offset", () => {
  assert.equal(createTaskTool.schema.parse({ title: "T" }).dueDate, undefined);
  assert.equal(createTaskTool.schema.parse({ title: "T", dueDate: null }).dueDate, null);
  assert.equal(
    createTaskTool.schema.parse({ title: "T", dueDate: "2026-03-01T00:00:00Z" }).dueDate,
    "2026-03-01T00:00:00Z",
  );
  // Bare date (no time/offset) must be rejected, matching createTaskSchema.
  assert.throws(() => createTaskTool.schema.parse({ title: "T", dueDate: "2026-03-01" }));
});
