import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskSchema, updateTaskSchema } from "./task.validation";

// --- createTaskSchema ---

test("createTaskSchema: valid minimal create (title only)", () => {
  const parsed = createTaskSchema.parse({ title: "Ship the release" });
  assert.deepEqual(parsed, {
    title: "Ship the release",
    status: "TODO",
    priority: "MEDIUM",
  });
});

test("createTaskSchema: defaults status/priority when omitted", () => {
  const parsed = createTaskSchema.parse({ title: "Ship the release" });
  assert.equal(parsed.status, "TODO");
  assert.equal(parsed.priority, "MEDIUM");
});

test("createTaskSchema: valid full create with every field set", () => {
  const parsed = createTaskSchema.parse({
    title: "Ship the release",
    description: "Cut the release branch and tag it",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeId: "user-1",
    dueDate: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(parsed, {
    title: "Ship the release",
    description: "Cut the release branch and tag it",
    status: "IN_PROGRESS",
    priority: "HIGH",
    assigneeId: "user-1",
    dueDate: "2026-01-01T00:00:00Z",
  });
});

test("createTaskSchema: trims surrounding whitespace from title", () => {
  const parsed = createTaskSchema.parse({ title: "  Ship the release  " });
  assert.equal(parsed.title, "Ship the release");
});

test("createTaskSchema: rejects an empty title (empty after trim too)", () => {
  assert.throws(() => createTaskSchema.parse({ title: "" }));
  assert.throws(() => createTaskSchema.parse({ title: "   " }));
});

test("createTaskSchema: rejects a title over 200 characters (bound applies after trim)", () => {
  assert.throws(() => createTaskSchema.parse({ title: "a".repeat(201) }));
  assert.throws(() => createTaskSchema.parse({ title: `  ${"a".repeat(201)}  ` }));
  // Exactly 200 remains valid.
  const title = "a".repeat(200);
  assert.equal(createTaskSchema.parse({ title }).title, title);
});

test("createTaskSchema: rejects a description over 10000 characters", () => {
  assert.throws(() =>
    createTaskSchema.parse({ title: "Task", description: "a".repeat(10001) }),
  );
  const description = "a".repeat(10000);
  assert.equal(
    createTaskSchema.parse({ title: "Task", description }).description,
    description,
  );
});

test("createTaskSchema: rejects an invalid status", () => {
  assert.throws(() => createTaskSchema.parse({ title: "Task", status: "DONE_ISH" }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", status: "" }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", status: 1 }));
});

test("createTaskSchema: rejects an invalid priority", () => {
  assert.throws(() => createTaskSchema.parse({ title: "Task", priority: "URGENTISH" }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", priority: "" }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", priority: 1 }));
});

test("createTaskSchema: accepts an explicit null assigneeId", () => {
  const parsed = createTaskSchema.parse({ title: "Task", assigneeId: null });
  assert.equal(parsed.assigneeId, null);
});

test("createTaskSchema: accepts an explicit null dueDate", () => {
  const parsed = createTaskSchema.parse({ title: "Task", dueDate: null });
  assert.equal(parsed.dueDate, null);
});

test("createTaskSchema: accepts a valid ISO datetime dueDate", () => {
  const parsed = createTaskSchema.parse({ title: "Task", dueDate: "2026-06-15T12:30:00Z" });
  assert.equal(parsed.dueDate, "2026-06-15T12:30:00Z");

  const withOffset = createTaskSchema.parse({
    title: "Task",
    dueDate: "2026-06-15T12:30:00+05:30",
  });
  assert.equal(withOffset.dueDate, "2026-06-15T12:30:00+05:30");
});

test("createTaskSchema: rejects a malformed dueDate", () => {
  assert.throws(() => createTaskSchema.parse({ title: "Task", dueDate: "not-a-date" }));
  // Date-only (no time component) is not a valid ISO datetime for this schema.
  assert.throws(() => createTaskSchema.parse({ title: "Task", dueDate: "2026-06-15" }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", dueDate: 1234 }));
});

test("createTaskSchema: rejects non-string values for string fields", () => {
  assert.throws(() => createTaskSchema.parse({ title: 123 }));
  assert.throws(() => createTaskSchema.parse({ title: null }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", description: 123 }));
  assert.throws(() => createTaskSchema.parse({ title: "Task", assigneeId: 123 }));
});

test("createTaskSchema: silently strips projectId/createdById (and other unknown fields)", () => {
  const parsed = createTaskSchema.parse({
    title: "Task",
    projectId: "attacker-project",
    createdById: "attacker",
  });
  assert.deepEqual(parsed, { title: "Task", status: "TODO", priority: "MEDIUM" });
});

// --- updateTaskSchema ---

test("updateTaskSchema: accepts a partial update with only one field", () => {
  const parsed = updateTaskSchema.parse({ status: "DONE" });
  assert.deepEqual(parsed, { status: "DONE" });
});

test("updateTaskSchema: never adds status/priority defaults for omitted fields", () => {
  const parsed = updateTaskSchema.parse({ title: "Renamed task" });
  assert.deepEqual(parsed, { title: "Renamed task" });
  assert.equal("status" in parsed, false);
  assert.equal("priority" in parsed, false);
});

test("updateTaskSchema: allows an explicit null description to clear it", () => {
  const parsed = updateTaskSchema.parse({ description: null });
  assert.deepEqual(parsed, { description: null });
});

test("updateTaskSchema: allows an explicit null assigneeId to unassign", () => {
  const parsed = updateTaskSchema.parse({ assigneeId: null });
  assert.deepEqual(parsed, { assigneeId: null });
});

test("updateTaskSchema: allows an explicit null dueDate to clear it", () => {
  const parsed = updateTaskSchema.parse({ dueDate: null });
  assert.deepEqual(parsed, { dueDate: null });
});

test("updateTaskSchema: rejects an empty title (empty after trim too)", () => {
  assert.throws(() => updateTaskSchema.parse({ title: "" }));
  assert.throws(() => updateTaskSchema.parse({ title: "   " }));
});

test("updateTaskSchema: silently strips a projectId field rather than accepting it", () => {
  const parsed = updateTaskSchema.parse({ title: "Renamed", projectId: "attacker-project" });
  assert.deepEqual(parsed, { title: "Renamed" });
});

test("updateTaskSchema: silently strips a createdById field rather than accepting it", () => {
  const parsed = updateTaskSchema.parse({ title: "Renamed", createdById: "attacker" });
  assert.deepEqual(parsed, { title: "Renamed" });
});

test("updateTaskSchema: silently strips unknown fields in general, same convention as every other schema here", () => {
  const parsed = updateTaskSchema.parse({
    status: "IN_REVIEW",
    somethingElse: "ignored",
  });
  assert.deepEqual(parsed, { status: "IN_REVIEW" });
});
