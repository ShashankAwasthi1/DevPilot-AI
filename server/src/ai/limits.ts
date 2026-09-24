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
  // Phase 26 Step 4 (RAG retrieval guardrails) - the maximum pgvector
  // cosine distance (embedding.<=> operator) a chunk may have to be
  // considered relevant at all, applied in the retrieval SQL's own WHERE
  // clause before LIMIT. Both embeddings are L2-normalized (see
  // local-embedding-provider.ts's normalize: true), so cosine distance
  // and cosine similarity relate by similarity = 1 - distance: 0.6
  // distance is equivalent to similarity >= 0.4. This is an unvalidated
  // heuristic (no labeled relevance dataset exists in this repo), chosen
  // deliberately on the permissive side so a normal, on-topic query is
  // never starved of results - kept as a single named, tunable constant
  // for exactly that reason.
  MAX_SEARCH_DISTANCE: 0.6,
  // Phase 26 Step 4 - how many candidate chunks the retrieval SQL query
  // fetches internally, independent of a caller's own final `limit`. Must
  // stay comfortably larger than MAX_SEARCH_RESULTS/any per-document cap
  // so post-retrieval processing (the diversity cap now, hybrid fusion in
  // a later step) has real candidates to work with rather than an
  // already-truncated top-N. Application code (never SQL) truncates to
  // the caller's actual `limit` only after that processing runs.
  SEARCH_CANDIDATE_LIMIT: 20,
  // Phase 19 (AI-proposed task creation) - how long a PendingTaskAction
  // stays confirmable after the AI proposes it. Checked lazily against
  // expiresAt at confirm time (see the Phase 19 Step 3 design); no cleanup
  // job required for correctness.
  PENDING_TASK_ACTION_TTL_MS: 15 * 60 * 1000,
  // Phase 22 Step 5 - the maximum number of PendingTaskAction rows a single
  // user may have simultaneously PENDING (across every conversation/
  // project) before a new proposal is rejected. Confirmed/cancelled/
  // expired rows never count - only genuinely open, still-actionable
  // proposals do. Conservative enough that no real user hits it during
  // normal review-and-confirm usage, low enough to bound unbounded
  // proposal accumulation.
  MAX_OPEN_PENDING_ACTIONS: 20,
  // Phase 25 (AI-generated project plan) - the maximum number of tasks a
  // single generateProjectPlan proposal may contain, enforced by the
  // tool's own Zod schema (.max()) before a PendingTaskAction row is ever
  // created. A conservative MVP bound: large enough for a genuinely useful
  // plan, small enough that a runaway/bulk plan can't be proposed for
  // confirmation in one shot.
  MAX_PLAN_TASKS: 20,
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
