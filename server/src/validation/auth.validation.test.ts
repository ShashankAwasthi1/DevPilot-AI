import { test } from "node:test";
import assert from "node:assert/strict";
import { loginSchema, signupSchema } from "./auth.validation";

// Phase 27 Step 3: auth.validation had no dedicated tests before this step.

// --- signupSchema ------------------------------------------------------

test("signupSchema: accepts a valid signup payload", () => {
  const result = signupSchema.safeParse({
    name: "Person",
    email: "person@example.com",
    password: "correct-horse-battery",
  });

  assert.equal(result.success, true);
});

test("signupSchema: trims and validates email format", () => {
  const result = signupSchema.safeParse({
    email: "  person@example.com  ",
    password: "correct-horse-battery",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.email, "person@example.com");
  }
});

test("signupSchema: rejects a malformed email", () => {
  const result = signupSchema.safeParse({
    email: "not-an-email",
    password: "correct-horse-battery",
  });

  assert.equal(result.success, false);
});

test("signupSchema: rejects a password shorter than the 8-character minimum", () => {
  const result = signupSchema.safeParse({
    email: "person@example.com",
    password: "short1",
  });

  assert.equal(result.success, false);
});

test("signupSchema: accepts a password at exactly the 8-character minimum", () => {
  const result = signupSchema.safeParse({
    email: "person@example.com",
    password: "12345678",
  });

  assert.equal(result.success, true);
});

test("signupSchema: accepts a password at exactly the 72-character maximum", () => {
  const result = signupSchema.safeParse({
    email: "person@example.com",
    password: "a".repeat(72),
  });

  assert.equal(result.success, true);
});

test("signupSchema: rejects a password over the 72-character maximum", () => {
  const result = signupSchema.safeParse({
    email: "person@example.com",
    password: "a".repeat(73),
  });

  assert.equal(result.success, false);
});

test("signupSchema: a missing name is accepted (name is optional)", () => {
  const result = signupSchema.safeParse({
    email: "person@example.com",
    password: "correct-horse-battery",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, undefined);
  }
});

test("signupSchema: an empty-string name is rejected when provided", () => {
  const result = signupSchema.safeParse({
    name: "",
    email: "person@example.com",
    password: "correct-horse-battery",
  });

  assert.equal(result.success, false);
});

// --- loginSchema ---------------------------------------------------------

test("loginSchema: accepts a valid login payload", () => {
  const result = loginSchema.safeParse({
    email: "person@example.com",
    password: "whatever-they-set-at-signup",
  });

  assert.equal(result.success, true);
});

test("loginSchema: rejects a malformed email", () => {
  const result = loginSchema.safeParse({
    email: "not-an-email",
    password: "whatever-they-set-at-signup",
  });

  assert.equal(result.success, false);
});

test("loginSchema: rejects an empty password", () => {
  const result = loginSchema.safeParse({
    email: "person@example.com",
    password: "",
  });

  assert.equal(result.success, false);
});

test("loginSchema: accepts a password at exactly the 72-character maximum (login enforces no minimum, unlike signup)", () => {
  const result = loginSchema.safeParse({
    email: "person@example.com",
    password: "a".repeat(72),
  });

  assert.equal(result.success, true);
});

test("loginSchema: rejects a password over the 72-character maximum", () => {
  const result = loginSchema.safeParse({
    email: "person@example.com",
    password: "a".repeat(73),
  });

  assert.equal(result.success, false);
});
