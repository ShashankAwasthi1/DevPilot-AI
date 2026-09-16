import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_LABEL, formatAssignee, formatFieldValue } from "./pending-action-format";
import type { ProjectMember } from "./types";

const MEMBERS: ProjectMember[] = [
  { userId: "user-1", name: "Rahul Sharma", email: "rahul@example.com", role: "MEMBER" },
  { userId: "user-2", name: null, email: "aman@example.com", role: "MEMBER" },
];

test("FIELD_LABEL: has a human-readable label for every supported field", () => {
  assert.deepEqual(FIELD_LABEL, {
    title: "Title",
    description: "Description",
    status: "Status",
    priority: "Priority",
    assigneeId: "Assignee",
    dueDate: "Due date",
  });
});

test("formatFieldValue: status converts canonical enum values to readable labels", () => {
  assert.equal(formatFieldValue("status", "TODO"), "To do");
  assert.equal(formatFieldValue("status", "IN_PROGRESS"), "In progress");
  assert.equal(formatFieldValue("status", "IN_REVIEW"), "In review");
  assert.equal(formatFieldValue("status", "DONE"), "Done");
});

test("formatFieldValue: priority converts canonical enum values to readable labels", () => {
  assert.equal(formatFieldValue("priority", "LOW"), "Low");
  assert.equal(formatFieldValue("priority", "MEDIUM"), "Medium");
  assert.equal(formatFieldValue("priority", "HIGH"), "High");
  assert.equal(formatFieldValue("priority", "URGENT"), "Urgent");
});

test("formatFieldValue: an unrecognized status/priority value falls back to a safe placeholder, never the raw value", () => {
  assert.equal(formatFieldValue("status", "BOGUS"), "—");
  assert.equal(formatFieldValue("priority", "BOGUS"), "—");
});

test("formatFieldValue: title renders as-is, null/empty falls back to a safe label", () => {
  assert.equal(formatFieldValue("title", "Fix authentication redirect bug"), "Fix authentication redirect bug");
  assert.equal(formatFieldValue("title", null), "Untitled");
});

test("formatFieldValue: description null renders as a safe 'No description' label, never the literal null", () => {
  assert.equal(formatFieldValue("description", null), "No description");
  assert.equal(formatFieldValue("description", "Updated details"), "Updated details");
});

test("formatFieldValue: dueDate null renders as 'No due date', a valid ISO string renders as a locale date", () => {
  assert.equal(formatFieldValue("dueDate", null), "No due date");
  const formatted = formatFieldValue("dueDate", "2026-03-01T00:00:00.000Z");
  assert.equal(formatted, new Date("2026-03-01T00:00:00.000Z").toLocaleDateString());
});

test("formatAssignee: null renders 'Unassigned'", () => {
  assert.equal(formatAssignee(null, MEMBERS), "Unassigned");
});

test("formatAssignee: a matching member id resolves to member.name", () => {
  assert.equal(formatAssignee("user-1", MEMBERS), "Rahul Sharma");
});

test("formatAssignee: a matching member with no name falls back to email", () => {
  assert.equal(formatAssignee("user-2", MEMBERS), "aman@example.com");
});

test("formatAssignee: an id with no matching member falls back to a safe 'Unknown member' label, never the raw id", () => {
  assert.equal(formatAssignee("user-does-not-exist", MEMBERS), "Unknown member");
});

test("formatFieldValue: assigneeId delegates to the same resolution as formatAssignee, handling old->new, old->Unassigned, Unassigned->new", () => {
  assert.equal(formatFieldValue("assigneeId", "user-1", MEMBERS), "Rahul Sharma");
  assert.equal(formatFieldValue("assigneeId", null, MEMBERS), "Unassigned");
  assert.equal(formatFieldValue("assigneeId", "user-2", MEMBERS), "aman@example.com");
});

test("formatFieldValue: defaults to an empty member list when none is supplied", () => {
  assert.equal(formatFieldValue("assigneeId", "user-1"), "Unknown member");
});
