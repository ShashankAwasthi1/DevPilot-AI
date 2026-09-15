import { test } from "node:test";
import assert from "node:assert/strict";
import { createMessageSchema } from "./conversation.validation";
import { AI_LIMITS } from "../ai/limits";

test("createMessageSchema: mode defaults to 'chat' when omitted, and is a strict enum otherwise", () => {
  assert.deepEqual(createMessageSchema.parse({ content: "hi" }), { content: "hi", mode: "chat" });
  assert.deepEqual(createMessageSchema.parse({ content: "hi", mode: "chat" }), { content: "hi", mode: "chat" });
  assert.deepEqual(createMessageSchema.parse({ content: "hi", mode: "agent" }), { content: "hi", mode: "agent" });

  assert.throws(() => createMessageSchema.parse({ content: "hi", mode: "admin" }));
  assert.throws(() => createMessageSchema.parse({ content: "hi", mode: "" }));
  assert.throws(() => createMessageSchema.parse({ content: "hi", mode: 1 }));
});

test("createMessageSchema: mode does not accept userId/projectId, and existing content limits are unchanged", () => {
  const parsed = createMessageSchema.parse({
    content: "hi",
    mode: "agent",
    userId: "attacker",
    projectId: "attacker-project",
  });
  // Zod's default (non-strict) object schema strips unknown keys rather
  // than rejecting them - either way, nothing beyond content/mode ever
  // reaches the controller through this schema's output.
  assert.deepEqual(parsed, { content: "hi", mode: "agent" });

  assert.throws(() => createMessageSchema.parse({ content: "" }));
  assert.throws(() => createMessageSchema.parse({ content: "a".repeat(AI_LIMITS.MAX_USER_MESSAGE_LENGTH + 1) }));
  assert.deepEqual(createMessageSchema.parse({ content: "a".repeat(AI_LIMITS.MAX_USER_MESSAGE_LENGTH) }), {
    content: "a".repeat(AI_LIMITS.MAX_USER_MESSAGE_LENGTH),
    mode: "chat",
  });
});
