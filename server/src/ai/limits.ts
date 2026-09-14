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
} as const;
