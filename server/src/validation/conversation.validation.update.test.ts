import { test } from "node:test";
import assert from "node:assert/strict";
import { updateConversationSchema } from "./conversation.validation";

test("updateConversationSchema: accepts a normal title", () => {
  assert.deepEqual(updateConversationSchema.parse({ title: "Auth debugging" }), {
    title: "Auth debugging",
  });
});

test("updateConversationSchema: trims surrounding whitespace", () => {
  assert.deepEqual(updateConversationSchema.parse({ title: "  Auth debugging  " }), {
    title: "Auth debugging",
  });
});

test("updateConversationSchema: rejects an empty string", () => {
  assert.throws(() => updateConversationSchema.parse({ title: "" }));
});

test("updateConversationSchema: rejects a whitespace-only string (empty after trim)", () => {
  assert.throws(() => updateConversationSchema.parse({ title: "   " }));
});

test("updateConversationSchema: rejects a title over 200 characters after trimming", () => {
  assert.throws(() => updateConversationSchema.parse({ title: "a".repeat(201) }));
  // Whitespace-padded but still over 200 chars once trimmed must also fail
  // - the bound applies after trim, not before.
  assert.throws(() => updateConversationSchema.parse({ title: `  ${"a".repeat(201)}  ` }));
});

test("updateConversationSchema: accepts a title of exactly 200 characters", () => {
  const title = "a".repeat(200);
  assert.deepEqual(updateConversationSchema.parse({ title }), { title });
});

test("updateConversationSchema: rejects a missing title", () => {
  assert.throws(() => updateConversationSchema.parse({}));
});

test("updateConversationSchema: rejects a non-string title", () => {
  assert.throws(() => updateConversationSchema.parse({ title: 123 }));
  assert.throws(() => updateConversationSchema.parse({ title: null }));
  assert.throws(() => updateConversationSchema.parse({ title: ["Auth"] }));
});

test("updateConversationSchema: silently strips unknown fields rather than rejecting them", () => {
  // Same non-strict z.object() convention as every other schema in this
  // file (see createMessageSchema's own test) - unknown keys never survive
  // into the parsed output, so userId/projectId (or anything else) can
  // never reach the controller through this schema regardless of whether
  // Zod treats an unrecognized key as an error or as noise to drop.
  const parsed = updateConversationSchema.parse({
    title: "Auth debugging",
    userId: "attacker",
    projectId: "attacker-project",
  });
  assert.deepEqual(parsed, { title: "Auth debugging" });
});
