// Centralized so every cap used when assembling context or validating input
// lives in one place. Character-length based (no tokenizer dependency) -
// an adequate proxy at this scale; revisit if truncation quality becomes a
// real problem.
export const AI_LIMITS = {
  MAX_CONTEXT_DOCUMENTS: 5,
  MAX_DOCUMENT_CHARS_EACH: 2000,
  MAX_ACTIVITY_ITEMS: 10,
  MAX_TASKS: 10,
  MAX_HISTORY_MESSAGES: 20,
  MAX_OUTPUT_TOKENS: 1024,
  MAX_USER_MESSAGE_LENGTH: 4000,
  // The absolute maximum number of provider.streamTurn() calls for one user
  // message. Must be >= 1 - this is a code-level invariant (a constant we
  // control), not user input, so no runtime guard is needed beyond keeping
  // this sane. The final permitted round never offers tools (see
  // tool-loop.ts), so only MAX_TOOL_ROUNDS - 1 rounds can actually use them.
  MAX_TOOL_ROUNDS: 4,
  // The absolute maximum number of tool handlers actually executed across
  // the whole turn, regardless of how many rounds or how many tool_use
  // blocks a single round returns.
  MAX_TOOL_CALLS_TOTAL: 6,
  // Serialized tool result content is bounded to this many characters -
  // truncated safely (see tool-loop.ts's boundToolResult), never mid-way
  // through a JSON structure.
  MAX_TOOL_RESULT_CHARS: 4000,
} as const;
