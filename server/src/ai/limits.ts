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
  // Phase 14 (RAG) document chunking - see ai/chunking.ts. Character-based,
  // same no-tokenizer-dependency convention as the rest of this file.
  MAX_CHUNK_CHARS: 1200,
  CHUNK_OVERLAP_CHARS: 150,
  MAX_CHUNKS_PER_DOCUMENT: 200,
  // Phase 14 (RAG) semantic search - see document-retrieval.service.ts and
  // ai/tools/search-documents.tool.ts. The query is bounded before it's
  // ever sent to the embedding provider.
  MAX_SEARCH_RESULTS: 5,
  MAX_SEARCH_QUERY_LENGTH: 300,
  // Phase 19 (AI-proposed task creation) - how long a PendingTaskAction
  // stays confirmable after the AI proposes it. Checked lazily against
  // expiresAt at confirm time (see the Phase 19 Step 3 design); no cleanup
  // job required for correctness.
  PENDING_TASK_ACTION_TTL_MS: 15 * 60 * 1000,
} as const;

// Phase 15 (Controlled AI Agent) - deliberately separate from AI_LIMITS
// above rather than additional keys on it: these bound a different
// orchestrator (agent-runner.ts's runAgentTurn) with its own round/call
// budget, and must never be confused with or accidentally repurpose
// ordinary chat's MAX_TOOL_ROUNDS/MAX_TOOL_CALLS_TOTAL. Output-size and
// tool-result-size bounds are NOT duplicated here - those are properties of
// a single provider round/tool result, not of which orchestrator is
// calling, so runAgentTurn's defaults reuse AI_LIMITS.MAX_OUTPUT_TOKENS and
// AI_LIMITS.MAX_TOOL_RESULT_CHARS directly.
export const AGENT_LIMITS = {
  MAX_AGENT_ROUNDS: 8,
  MAX_AGENT_TOOL_CALLS_TOTAL: 12,
  MAX_AGENT_TIMEOUT_MS: 60000,
} as const;
