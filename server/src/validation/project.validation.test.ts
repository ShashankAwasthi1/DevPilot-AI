import { test } from "node:test";
import assert from "node:assert/strict";
import { addProjectMemberSchema, updateProjectMemberRoleSchema } from "./project.validation";

// Scoped to addProjectMemberSchema/updateProjectMemberRoleSchema only -
// createProjectSchema/updateProjectSchema have no dedicated test file
// today and are out of scope for these features.

test("addProjectMemberSchema: accepts a valid email with each allowed role", () => {
  for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
    const result = addProjectMemberSchema.safeParse({ email: "person@example.com", role });
    assert.ok(result.success, `role ${role} should be accepted`);
  }
});

test("addProjectMemberSchema: trims the email", () => {
  const result = addProjectMemberSchema.safeParse({ email: "  person@example.com  ", role: "MEMBER" });
  assert.ok(result.success);
  assert.equal(result.data?.email, "person@example.com");
});

test("addProjectMemberSchema: rejects an invalid email", () => {
  const result = addProjectMemberSchema.safeParse({ email: "not-an-email", role: "MEMBER" });
  assert.equal(result.success, false);
});

test("addProjectMemberSchema: rejects a missing email", () => {
  const result = addProjectMemberSchema.safeParse({ role: "MEMBER" });
  assert.equal(result.success, false);
});

test("addProjectMemberSchema: rejects OWNER as a requested role", () => {
  const result = addProjectMemberSchema.safeParse({ email: "person@example.com", role: "OWNER" });
  assert.equal(result.success, false);
});

test("addProjectMemberSchema: rejects an unrecognized role string", () => {
  const result = addProjectMemberSchema.safeParse({ email: "person@example.com", role: "SUPERADMIN" });
  assert.equal(result.success, false);
});

test("addProjectMemberSchema: rejects a missing role", () => {
  const result = addProjectMemberSchema.safeParse({ email: "person@example.com" });
  assert.equal(result.success, false);
});

test("addProjectMemberSchema: silently strips projectId/userId rather than accepting them", () => {
  const result = addProjectMemberSchema.safeParse({
    email: "person@example.com",
    role: "MEMBER",
    projectId: "someone-elses-project",
    userId: "arbitrary-user-id",
  });
  assert.ok(result.success);
  assert.deepEqual(Object.keys(result.data ?? {}).sort(), ["email", "role"]);
});

test("updateProjectMemberRoleSchema: accepts each allowed role", () => {
  for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
    const result = updateProjectMemberRoleSchema.safeParse({ role });
    assert.ok(result.success, `role ${role} should be accepted`);
  }
});

test("updateProjectMemberRoleSchema: rejects OWNER as a requested role", () => {
  const result = updateProjectMemberRoleSchema.safeParse({ role: "OWNER" });
  assert.equal(result.success, false);
});

test("updateProjectMemberRoleSchema: rejects an invalid role", () => {
  const result = updateProjectMemberRoleSchema.safeParse({ role: "SUPERADMIN" });
  assert.equal(result.success, false);
});

test("updateProjectMemberRoleSchema: rejects a missing role", () => {
  const result = updateProjectMemberRoleSchema.safeParse({});
  assert.equal(result.success, false);
});

test("updateProjectMemberRoleSchema: silently strips projectId/userId rather than accepting them", () => {
  const result = updateProjectMemberRoleSchema.safeParse({
    role: "MEMBER",
    projectId: "someone-elses-project",
    userId: "arbitrary-user-id",
  });
  assert.ok(result.success);
  assert.deepEqual(Object.keys(result.data ?? {}).sort(), ["role"]);
});
