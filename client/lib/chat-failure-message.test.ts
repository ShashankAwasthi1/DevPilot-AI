import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERIC_CHAT_FAILURE_MESSAGE, resolveChatFailureMessage } from "./chat-failure-message";

test("resolveChatFailureMessage: returns the specific backend message when present (e.g. a timeout-specific message)", () => {
  const result = resolveChatFailureMessage("The request took too long to complete.");

  assert.equal(result, "The request took too long to complete.");
});

test("resolveChatFailureMessage: returns a different specific message just as faithfully (e.g. a genuine provider failure), proving timeout and provider failures render distinguishably", () => {
  const result = resolveChatFailureMessage("Something went wrong generating a response.");

  assert.equal(result, "Something went wrong generating a response.");
});

test("resolveChatFailureMessage: falls back to the generic message when no message is provided", () => {
  const result = resolveChatFailureMessage(undefined);

  assert.equal(result, GENERIC_CHAT_FAILURE_MESSAGE);
});

test("resolveChatFailureMessage: falls back to the generic message for an empty string too (defensive - never renders a blank line)", () => {
  const result = resolveChatFailureMessage("");

  assert.equal(result, GENERIC_CHAT_FAILURE_MESSAGE);
});
