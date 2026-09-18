// The one fallback string chat-panel.tsx has always shown for a failed
// assistant turn - kept here, not inline in the component, so the
// "specific message, else this fallback" decision is a small, pure,
// directly-testable function (components/chat/use-chat-turn.ts and
// *.tsx files aren't covered by this project's test runner - see
// package.json's "test" script - so the actual decision logic lives here
// instead, in lib/, and the component just calls it).
export const GENERIC_CHAT_FAILURE_MESSAGE = "This response failed to generate.";

// The backend only ever sends a fixed, safe string for a chat/agent
// failure (see server/src/controllers/message.controller.ts's
// AGENT_ERROR_MESSAGES and its generic catch-all) - never a raw
// exception, stack trace, or provider detail - so it's always safe to
// render as-is once present. An empty string is treated the same as
// "absent" (falls back to the generic message) as a defensive measure,
// even though the backend/parser never actually produces one today.
export function resolveChatFailureMessage(failureMessage: string | undefined): string {
  return failureMessage && failureMessage.length > 0 ? failureMessage : GENERIC_CHAT_FAILURE_MESSAGE;
}
