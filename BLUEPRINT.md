# DevPilot AI — Master Product & Technical Blueprint

Status: Planning document. No implementation yet. This is the reference we build every phase against.

> **Implementation note (Phase 11):** as of Phase 2, the backend is a separate Express + TypeScript service, not Next.js API routes as described in §15/16/21/24. See [docs/adr/0001-separate-express-backend.md](docs/adr/0001-separate-express-backend.md). Sections below are retained as original planning context and have not been updated to reflect this.

---

## 1. Product Overview

DevPilot AI is an AI-native project & task management workspace for software teams. It combines the core mechanics of tools like Linear/Notion/Jira (projects, tasks, docs, collaboration) with a project-aware AI assistant that can answer questions, generate plans, create/update tasks under human-approved guardrails, and search a team's own documentation via RAG. The differentiator is not "another PM tool" — it's a PM tool where the AI has real, permissioned access to the team's actual data and can act on it safely.

## 2. Problem Being Solved

- Small dev teams and solo/indie developers juggle scattered tools (issue tracker, docs, chat, planning spreadsheets) and lose time re-explaining project context to a general AI chatbot that has no memory of their actual project.
- Generic AI chat tools (ChatGPT/Claude web) are powerful but disconnected from a team's live task/project state — copy-pasting context back and forth is friction.
- Existing PM tools with "AI features" mostly bolt on text generation (summarize this ticket) rather than giving AI real, safe, tool-mediated access to create/update project state.

## 3. Target Users

- Solo developers and indie hackers managing multiple side projects.
- Small dev teams (2–15 people) at startups without dedicated PM tooling budget.
- Technical founders who want lightweight PM + docs + AI in one place.
- (Secondary/portfolio audience) engineers evaluating this as a demonstration of AI-native SaaS architecture.

## 4. Product Goals

1. Be genuinely useful as a daily-driver task/project tool, independent of AI.
2. Make the AI assistant feel like a knowledgeable teammate who knows the project, not a generic chatbot.
3. Never let AI silently mutate data — all writes are explicit, permissioned, and (for destructive ones) confirmed.
4. Ship a real, deployed, usable product — not a local demo.
5. Keep the codebase small and legible enough for one developer to fully understand and extend.

## 5. User Personas

- **Priya, solo indie developer** — runs 3 side projects solo, wants fast task capture, AI-generated project plans when starting something new, and a knowledge base that doesn't rot.
- **Sam, engineering lead at a 6-person startup** — needs shared visibility into what the team is doing, sprint-ish planning, and wants the AI to draft task breakdowns from a rough feature spec instead of Sam writing every ticket by hand.
- **Dev, individual contributor** — mostly interacts with tasks assigned to them, uses AI chat to ask "what's blocking X" or "summarize the last 10 comments on this task" instead of reading everything.

## 6. Core User Flows

1. **Onboarding** — sign up → create first project → (optional) AI generates an initial task breakdown from a one-paragraph project description → land on project board.
2. **Daily task loop** — open dashboard → see assigned tasks across projects → update status → add comment → get notified on mentions/assignments.
3. **AI-assisted planning** — user describes a feature in chat → AI proposes a structured task list (title, description, priority, estimate) → user reviews/edits → confirms → tasks are created via tool call.
4. **Project-aware Q&A** — user asks "what's the status of the auth refactor" → AI retrieves relevant tasks/docs via RAG + tool calls → answers with citations/links back to the actual task/doc.
5. **Knowledge base** — user writes/uploads project docs → docs are chunked + embedded → AI can answer questions grounded in them → doc search is also available as plain full-text search for humans.
6. **Team collaboration** — invite member → assign role → member sees only projects they're a member of → activity feed shows who did what.

## 7. MVP Features

- Auth (email/password + OAuth via a managed provider), sessions.
- User profile (name, avatar, basic settings).
- Projects: create/edit/archive, single owner + members.
- Project members: invite by email, roles (Owner/Admin/Member/Viewer).
- Tasks: CRUD, status (Todo/In Progress/In Review/Done), priority, assignee, due date.
- Basic Kanban board + list view, search/filter/sort by status/assignee/priority.
- Comments on tasks.
- Documentation/knowledge base: create/edit markdown docs per project.
- AI chat (project-scoped): conversational chat with access to a fixed tool set (getProject, getTasks, createTask, updateTask, searchDocuments) and RAG over that project's docs.
- AI-generated task plan from a text prompt (structured output → preview → user confirms → tasks created).
- Notifications (in-app): assignment, mention, comment.
- Activity history per project.
- Basic account/workspace settings.
- Dashboard: cross-project view of "my tasks," recent activity.

## 8. Future Features

**Phase 2**
- Sprint/cycle support (time-boxed groupings of tasks, burndown).
- Analytics dashboard (throughput, cycle time, AI usage stats).
- File attachments on tasks/docs (object storage).
- Real-time collaboration (WebSocket-based live board updates, presence).
- Email notifications (digest + immediate).
- AI conversation memory across sessions per project.
- deleteTask and other destructive tools with mandatory confirmation UI.
- getProjectAnalytics tool.

**Phase 3**
- AI agent workflows: multi-step tool-calling chains (e.g., "triage all unlabeled tasks") with a plan-then-execute UI and approval gate.
- Cross-project AI search ("what have I been working on this week across all projects").
- Slack/GitHub integrations (import issues, post updates).
- Custom fields / workflow states per project.
- Public API + API keys for external integrations.

**Advanced / Future**
- MCP server exposing DevPilot AI's tools to external AI clients (with the same auth/permission layer).
- Multi-model routing (choose provider per task type).
- Fine-grained audit log export / compliance features.
- Self-serve billing/subscription tiers.

## 9. UI/UX Design Direction

- Visual language: clean modern SaaS — generous whitespace, one accent color, neutral grays, subtle elevation via shadow not borders. Inter or a similar geometric sans for UI, a slightly warmer serif/mono accent only if used sparingly (e.g., code blocks).
- Layout: persistent left sidebar (workspace/projects nav) + top bar (search, notifications, account) + main content area. Command palette (Cmd+K) for navigation and quick actions — this is the "search/command experience."
- Theming: light/dark via CSS variables + a system-preference default, togglable, persisted per user.
- Motion: purposeful only — page transitions via simple fade/slide (Framer Motion or CSS view-transitions), skeleton loaders for anything async, micro-interactions on buttons/cards (subtle scale/opacity on hover, not on every element), animated charts only where they clarify a trend, no decorative background animation unless it's a static/low-cost gradient mesh on the landing page only. All motion respects `prefers-reduced-motion`.
- States: every list/board has an explicit empty state (illustration + CTA), every async view has a skeleton, every mutation gives a toast, errors are actionable (not just "something went wrong").
- AI chat UI: dedicated panel (slide-over or full-page), streaming responses, visible "tool call" chips when the AI invokes a tool (e.g., "Searched documents…", "Creating 4 tasks — review below"), inline confirmation cards for any write action before it's committed.
- Accessibility: semantic HTML, keyboard navigable command palette and forms, focus states never removed, color contrast AA minimum, motion-reduced fallback for all animation.

## 10. AI Product Strategy

- Positioning: "an AI teammate that actually knows your project," not a generic assistant window.
- Every AI response that touches project data must be groundable — either via a tool call result or a retrieved document chunk — and the UI should show what was consulted.
- Trust is built incrementally: MVP AI can read anything in-scope and create tasks; update/delete require explicit confirmation; multi-step "agent" behavior is a Phase 3 feature gated behind a visible plan-review step.
- AI usage is metered and visible to the user/workspace (Phase 2 analytics) so cost is never a surprise.

## 11. AI Architecture

**Provider abstraction.** Use the Vercel AI SDK (`ai` package) as a provider-agnostic layer over Anthropic/OpenAI/Google so the model can be swapped per environment or per task without rewriting call sites. Default to Anthropic Claude for conversational/tool-calling quality; keep the abstraction so a cheaper/faster model can be used for embeddings or simple summarization.

**Structured output.** All AI outputs that become application data (task plans, generated tasks) are constrained with Zod schemas via the SDK's structured-output/tool-calling support — never parsed out of free text.

**Tool layer (the core safety boundary):**

```
User message
   → AI (model call, sees only the tool definitions it's allowed)
   → Tool invocation request (structured, args validated against Zod schema)
   → Backend tool handler
        - re-checks auth: is this user allowed to act on this project/task?
        - re-validates args (never trusts the model's arguments blindly)
        - if destructive (update/delete): returns a "pending confirmation" object instead of executing
   → On confirm: handler executes against the service/DB layer
   → Result (typed, minimal fields) returned to the model
   → Model produces final natural-language answer
   → User (sees answer + a rendered card of what actually happened)
```

- Tools are plain backend functions with a name, Zod input schema, and a handler — the AI never gets a raw DB client or arbitrary SQL/code execution.
- MVP tool set: `getProject`, `getTasks`, `createTask`, `searchDocuments`. Phase 2 adds `updateTask`, `getProjectAnalytics`, `generateProjectPlan` (returns a structured plan, doesn't write until confirmed). Phase 2+/3 adds `deleteTask` (confirmation mandatory, non-negotiable in code, not just UI).
- Every tool call and its result is logged (AIUsage/Activity) for audit and for the analytics feature.

**RAG.** Documents are chunked (by heading/size), embedded (OpenAI or Voyage embeddings, stored via pgvector in Postgres — avoids a separate vector DB for MVP scale), and retrieved by cosine similarity filtered to the requesting user's project scope. Retrieval is itself a tool call (`searchDocuments`) so it goes through the same auth boundary as everything else — the model cannot retrieve chunks outside projects the user can access.

**Prompt injection defense.** Treat all retrieved document/task content as untrusted data, not instructions: system prompt explicitly instructs the model to treat retrieved content as reference only; tool outputs are inserted as clearly delimited data blocks; the model is never given a tool that can change its own permissions or fetch/execute arbitrary content; destructive tools always require a separate, explicit user confirmation step server-side (not just "the model said the user confirmed").

**Memory.** MVP: conversation is scoped to a single chat session (stored, resumable). Phase 2: per-project conversation history the AI can be pointed back to; no cross-user memory sharing.

## 12. Security Architecture

- **AuthN**: managed via Auth.js (NextAuth) or Clerk — email/password + OAuth (GitHub/Google), hashed passwords (bcrypt/argon2 if credentials are self-managed), secure httpOnly session cookies (JWT or DB session, prefer DB session for revocability).
- **AuthZ / RBAC**: every project has members with a role (Owner/Admin/Member/Viewer); every API route and every AI tool handler checks membership + role before touching data — this check lives in one shared authorization module, not duplicated ad hoc.
- **Input validation**: Zod schemas at every API boundary and every AI tool boundary; reject unknown fields.
- **API security**: rate limiting (per-IP and per-user, via Redis token bucket) on auth endpoints and AI endpoints especially; CORS locked to the app's own origin; CSRF protection via same-site cookies + framework defaults (Next.js API routes / double-submit token if needed).
- **XSS**: React's default escaping + sanitize any markdown-rendered user content (docs, comments) with a strict allowlist (e.g., `rehype-sanitize`).
- **SQL injection**: Prisma/Drizzle parameterized queries only, no raw string interpolation into SQL.
- **Secrets**: all API keys/DB credentials in environment variables, never committed, never sent to the client; server-only AI calls (no client-side API keys).
- **File uploads (Phase 2)**: type/size validation, virus-scan hook if feasible, stored in object storage (not the app server), served via signed URLs, never executed.
- **AI-specific**: prompt injection mitigations above; tool authorization re-checked server-side regardless of what the model claims; AI never has a "run raw SQL" or "run shell command" tool.
- **Audit logging**: every write (task/doc mutation, member role change, AI tool execution) recorded in an Activity/AuditLog table with actor, action, target, timestamp.
- **Data isolation**: all queries scoped by project membership at the query layer (never trust a client-supplied projectId alone — always join through membership).

## 13. Database Design

Postgres, via Prisma (chosen for MVP velocity + migration ergonomics; Drizzle is a reasonable alternative if the user prefers SQL-closer typing — either works, pick one and stay consistent).

Core entities:

- **User** — id, email, passwordHash?, name, avatarUrl, createdAt.
- **Project** — id, name, description, ownerId, createdAt, archivedAt?.
- **ProjectMember** — id, projectId, userId, role (enum: OWNER/ADMIN/MEMBER/VIEWER), createdAt. Unique on (projectId, userId).
- **Task** — id, projectId, title, description, status (enum), priority (enum), assigneeId?, dueDate?, createdById, createdAt, updatedAt.
- **Comment** — id, taskId, authorId, body, createdAt.
- **Document** — id, projectId, title, content (markdown), createdById, updatedAt.
- **DocumentChunk** — id, documentId, content, tokenCount, chunkIndex.
- **Embedding** — id, documentChunkId, vector (pgvector), model. (Could be merged into DocumentChunk as a column; kept separate here in case multiple embedding models are supported later.)
- **Conversation** — id, projectId?, userId, title, createdAt.
- **Message** — id, conversationId, role (user/assistant/tool), content, toolCalls (json)?, createdAt.
- **AIUsage** — id, userId, conversationId?, provider, model, inputTokens, outputTokens, toolName?, createdAt.
- **Notification** — id, userId, type, payload (json), readAt?, createdAt.
- **Activity** — id, projectId, actorId, action, targetType, targetId, metadata (json), createdAt.

Relationships: User 1–N Project (owner), User N–N Project via ProjectMember, Project 1–N Task/Document/Conversation/Activity, Task 1–N Comment, Document 1–N DocumentChunk 1–1 Embedding, Conversation 1–N Message, User 1–N Notification/AIUsage.

Indexing: (projectId, status) on Task, (projectId) on Document/Activity, vector index (ivfflat/hnsw) on Embedding.vector, (userId, readAt) on Notification.

## 14. API Design

REST, versioned under `/api/v1`. Grouped as:

- **Auth**: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, session handled by Auth.js routes.
- **Users**: `GET /me`, `PATCH /me`.
- **Projects**: `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id`.
- **Project Members**: `GET /projects/:id/members`, `POST /projects/:id/members` (invite), `PATCH /projects/:id/members/:userId` (role change), `DELETE /projects/:id/members/:userId`.
- **Tasks**: `GET /projects/:id/tasks` (filter/sort query params), `POST /projects/:id/tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id`, `POST /tasks/:id/comments`.
- **Documents**: `GET /projects/:id/documents`, `POST /projects/:id/documents`, `GET /documents/:id`, `PATCH /documents/:id`, `DELETE /documents/:id`.
- **Search**: `GET /search?q=` (full-text, human-facing) — separate from AI's internal `searchDocuments` tool which does vector search.
- **AI**: `POST /ai/conversations`, `GET /ai/conversations/:id`, `POST /ai/conversations/:id/messages` (streams response, internally dispatches tool calls), `POST /ai/plan` (generateProjectPlan → returns structured plan for review, does not persist).
- **Analytics** (Phase 2): `GET /projects/:id/analytics`.
- **Notifications**: `GET /notifications`, `PATCH /notifications/:id/read`.

## 15. Frontend Architecture

- Next.js (App Router) + TypeScript + Tailwind CSS. React Server Components for data-heavy read views (project list, task board initial load); client components for interactive board/chat/forms.
- State: server data via React Query (or Next's built-in fetch caching + server actions) for cache/invalidation; local UI state via Zustand only where needed (e.g., command palette open state, chat panel state) — avoid a heavy global store.
- Component structure: `app/(marketing)` for landing, `app/(app)/dashboard`, `app/(app)/projects/[id]`, shared `components/ui` (design-system primitives, likely shadcn/ui on Radix for accessible unstyled primitives + Tailwind), `components/ai-chat`, `components/board`.
- Forms: React Hook Form + Zod resolver, shared Zod schemas between client validation and API validation where possible.
- Charts: a lightweight library (Recharts/visx) for the Phase 2 analytics dashboard, following purposeful-animation guidance.

## 16. Backend Architecture

- Modular monolith inside the same Next.js app initially (API routes / route handlers), organized by domain module (`modules/projects`, `modules/tasks`, `modules/ai`, `modules/documents`), each with its own service layer, validators, and (if the app later needs to split) a clean seam to extract into a separate Node/Express service.
- Layering per module: `route handler → validate (Zod) → authorize (shared RBAC check) → service function → Prisma`. AI tool handlers call the same service functions as the REST routes — one source of truth for business logic, so "AI does X" and "user does X via UI" are guaranteed to enforce identical rules.
- Background jobs (Phase 2+): a lightweight queue (BullMQ + Redis) for embedding generation, digest emails, and any multi-step AI agent execution — kept out of the request/response cycle.

## 17. Infrastructure Architecture

- Redis: rate limiting, BullMQ job queue, session/cache (Phase 2 real-time presence).
- WebSockets (Phase 2): Pusher/Ably (managed) or a lightweight self-hosted socket layer for live board updates — start with polling/React Query refetch for MVP, add real-time only when it earns its complexity.
- Docker: docker-compose for local Postgres + Redis; app itself runs natively in dev, containerized for deploy if not using a platform that builds directly from git (Vercel does).
- CI/CD: GitHub Actions — lint, typecheck, unit + integration tests, build, on PR; deploy on merge to main.
- Monitoring/logging: structured logging (pino), error tracking (Sentry), uptime/health checks, basic AI-call logging (latency, token usage, errors) as its own log stream.

## 18. Scalability Strategy

- Pagination (cursor-based) on all list endpoints from day one.
- Indexes as listed in §13; connection pooling via Prisma's built-in pool or PgBouncer if serverless.
- Redis caching for expensive/read-heavy queries (project member lists, analytics aggregates) with explicit invalidation on writes.
- Background jobs for anything not needed synchronously (embedding generation, notification fan-out).
- Object storage (S3-compatible) for files, never the app server's filesystem.
- CDN via the hosting platform (Vercel edge network) for static assets.
- AI request management: per-user/workspace rate limits on AI endpoints, token-usage caps configurable per plan, request queuing for burst protection.
- Horizontal scaling: stateless app servers (sessions in DB/Redis, not memory) so the platform can scale instances freely.

## 19. Reliability Strategy

- Centralized error handling middleware; consistent API error shape.
- Retries with backoff for AI provider calls and any external HTTP calls (idempotency considered for retried writes).
- Timeouts on all external calls (AI provider, DB) with sane defaults.
- Graceful degradation: if AI provider is down, the rest of the app (tasks/docs/projects) remains fully usable; chat surfaces a clear "AI temporarily unavailable" state.
- Health check endpoint (`/api/health`) checking DB + Redis connectivity for uptime monitoring.
- Automated DB backups (managed Postgres provider feature) + documented restore process.
- Testing (below) as the primary reliability lever pre-release.

## 20. Testing Strategy

- Unit tests (Vitest/Jest): service-layer functions, Zod schemas, RBAC logic, tool handlers (mocking the model, testing the auth/validation boundary).
- Integration tests: API routes against a test Postgres instance (Testcontainers or a dedicated test DB), covering auth flows and the full request→service→DB path.
- E2E tests (Playwright): core flows — sign up, create project, create task, AI chat producing a task plan and confirming it, doc creation + AI search finding it.
- AI-specific tests: deterministic tests against the tool layer (does `createTask` reject invalid args, does it enforce membership) independent of the LLM; a smaller set of live-model smoke tests behind a flag (not run on every CI push, to control cost) verifying the model actually calls the right tool for a canonical prompt.
- Security testing: automated dependency scanning (GitHub Dependabot/CodeQL), manual review pass before each major release using the `/security-review` workflow.
- UI testing: component tests for critical interactive components (board drag/drop, chat streaming render) plus visual smoke via Playwright screenshots on key pages.

## 21. Deployment Strategy

Practical for a solo developer, scalable if it grows:

- **Frontend + backend**: Vercel (Next.js first-class support, edge network, zero-config CI from GitHub, generous free tier for a portfolio-stage app).
- **PostgreSQL**: managed provider with pgvector support — Supabase or Neon (both support pgvector; Supabase also bundles auth/storage if that's preferred over rolling your own, but plan assumes self-managed auth for control).
- **Redis**: Upstash (serverless-friendly, works well with Vercel's serverless functions).
- **Object storage** (Phase 2): Cloudflare R2 or S3.
- **Domain/HTTPS**: any registrar + Vercel-managed TLS.
- **Environment variables**: Vercel project environment variables, separate dev/preview/prod values, never committed; `.env.example` checked in with placeholder keys.
- **CI/CD**: GitHub Actions runs lint/typecheck/tests on every PR; Vercel auto-deploys preview per PR and production on merge to `main`.
- **Monitoring**: Sentry (errors), Vercel Analytics (perf), a simple internal `/admin` or log dashboard for AI usage once it exists.

## 22. Development Phases

Each phase keeps the app runnable end-to-end. Roughly 15–25 phases as requested.

**Phase 0 — Project Setup**
- Goal: runnable skeleton app with tooling in place.
- Features: none user-facing yet.
- Tech: Next.js + TS + Tailwind, ESLint/Prettier, GitHub repo, CI skeleton.
- Files: `app/`, `package.json`, `.eslintrc`, `.github/workflows/ci.yml`.
- Learn: Next.js App Router basics, CI fundamentals.
- Steps: scaffold app, configure Tailwind, set up lint/format, push CI that runs lint+build.
- Testing: CI passes on empty app.
- Commit: "chore: project scaffold with Next.js, TypeScript, Tailwind, CI".
- Done when: `npm run dev` renders a blank app and CI is green.

**Phase 1 — Database & ORM**
- Goal: Postgres schema for core entities (User, Project, ProjectMember, Task).
- Tech: Prisma, local Postgres via docker-compose.
- Files: `prisma/schema.prisma`, `docker-compose.yml`.
- Learn: relational modeling, Prisma migrations.
- Steps: define schema, run migration, seed script.
- Testing: migration applies cleanly, seed script runs.
- Commit: "feat: initial database schema (User, Project, ProjectMember, Task)".
- Done when: `prisma studio` shows seeded data.

**Phase 2 — Authentication**
- Goal: real sign-up/login.
- Tech: Auth.js (credentials + GitHub OAuth), bcrypt.
- Files: `app/api/auth/[...nextauth]`, `lib/auth.ts`.
- Learn: session vs JWT auth, OAuth flow.
- Steps: configure Auth.js, protect routes with middleware, build login/register pages.
- Testing: integration test for register/login; manual OAuth test.
- Commit: "feat: authentication with Auth.js".
- Done when: a user can register, log in, log out, and hit a protected page.

**Phase 3 — User Profile & Settings**
- Goal: basic account management.
- Files: `app/(app)/settings`, `modules/users`.
- Steps: profile view/edit, avatar upload placeholder.
- Testing: unit test for update-profile service.
- Commit: "feat: user profile and settings page".
- Done when: user can update name/avatar and see it reflected.

**Phase 4 — Projects CRUD**
- Goal: create/list/edit/archive projects.
- Files: `modules/projects`, `app/(app)/projects`.
- Steps: service layer, API routes, project list + create UI.
- Testing: integration tests for all project routes incl. authorization (non-member can't access).
- Commit: "feat: project CRUD with authorization".
- Done when: a user can create a project and only its members can view it.

**Phase 5 — Project Members & RBAC**
- Goal: invite members, enforce roles.
- Files: `modules/members`, shared `lib/authorize.ts`.
- Steps: invite-by-email, role assignment, central authorize() helper used everywhere going forward.
- Testing: unit tests for every role/action combination.
- Commit: "feat: project membership and RBAC".
- Done when: role-based access is enforced on every existing route.

**Phase 6 — Tasks CRUD + Board UI**
- Goal: core task management.
- Files: `modules/tasks`, `components/board`.
- Steps: task service/routes, Kanban board (drag/drop), list view, filters.
- Testing: integration tests for task routes; Playwright test for create-task-drag-to-done.
- Commit: "feat: task management with Kanban board".
- Done when: tasks can be created, moved across statuses, filtered/sorted.

**Phase 7 — Comments & Activity Feed**
- Goal: collaboration primitives.
- Files: `modules/comments`, `modules/activity`.
- Steps: comment CRUD, Activity table populated by a shared logging helper called from every service mutation.
- Testing: unit test that mutating a task writes an Activity row.
- Commit: "feat: task comments and activity log".
- Done when: commenting works and the project activity feed reflects real actions.

**Phase 8 — Notifications**
- Goal: in-app notifications for assignment/mention/comment.
- Files: `modules/notifications`.
- Steps: notification creation hooks, notification bell UI, mark-as-read.
- Testing: unit test notification creation on assignment.
- Commit: "feat: in-app notifications".
- Done when: assigning a task notifies the assignee in the UI.

**Phase 9 — Documentation / Knowledge Base**
- Goal: markdown docs per project.
- Files: `modules/documents`.
- Steps: doc CRUD, markdown editor + sanitized render, full-text search endpoint.
- Testing: sanitization test (XSS payload doesn't render), search returns expected doc.
- Commit: "feat: project documentation with markdown".
- Done when: docs can be created/edited and found via search.

**Phase 10 — Dashboard**
- Goal: cross-project "my work" view.
- Files: `app/(app)/dashboard`.
- Steps: aggregate query for assigned tasks + recent activity across projects.
- Testing: integration test for aggregate endpoint scoping to the user's projects only.
- Commit: "feat: cross-project dashboard".
- Done when: dashboard shows only the logged-in user's relevant tasks/activity.

**Phase 11 — Landing Page & Polish Pass 1**
- Goal: public marketing page, design-system pass on core pages.
- Files: `app/(marketing)`, `components/ui`.
- Steps: hero, feature sections, empty/skeleton/error states across MVP screens, dark/light theme toggle.
- Testing: Lighthouse pass, reduced-motion check.
- Commit: "feat: landing page and UI polish pass".
- Done when: app feels like a coherent product, not a CRUD scaffold.

**Phase 12 — AI Provider Layer & Basic Chat**
- Goal: plain conversational AI chat, no tools yet.
- Tech: Vercel AI SDK, Anthropic provider.
- Files: `modules/ai/chat`, `components/ai-chat`.
- Learn: streaming responses, provider abstraction.
- Steps: conversation/message persistence, streaming chat UI.
- Testing: integration test that a message round-trips and persists.
- Commit: "feat: AI chat with streaming responses".
- Done when: user can have a persisted, streamed conversation (no project awareness yet).

**Phase 13 — AI Tool Layer: Read Tools**
- Goal: `getProject`, `getTasks`, `searchDocuments` wired as model tools.
- Files: `modules/ai/tools`.
- Learn: tool-calling / function-calling patterns, Zod tool schemas.
- Steps: define tool schemas, implement handlers reusing existing service functions, enforce membership check inside every handler.
- Testing: unit tests calling each tool handler directly with valid/invalid auth.
- Commit: "feat: AI read tools (getProject, getTasks, searchDocuments)".
- Done when: AI chat can correctly answer "what tasks are in project X" using real data, and cannot answer for a project the user isn't a member of.

**Phase 14 — RAG / Embeddings**
- Goal: `searchDocuments` becomes real vector search.
- Tech: pgvector, embeddings API.
- Files: `modules/ai/rag`, migration adding `DocumentChunk`/`Embedding`.
- Learn: chunking strategy, embeddings, vector similarity search.
- Steps: chunk on doc save, generate + store embeddings (background job), similarity query scoped by project membership.
- Testing: test that a query returns the relevant chunk and never returns chunks from a project the user can't access.
- Commit: "feat: RAG over project documents with pgvector".
- Done when: AI answers a doc-grounded question correctly with a citation back to the source doc.

**Phase 15 — AI Write Tool: createTask + Structured Plans**
- Goal: `createTask` tool + `generateProjectPlan` structured output with review-before-create UX.
- Files: `modules/ai/tools`, `components/ai-chat/plan-preview`.
- Learn: structured output validation, confirm-before-write UX pattern.
- Steps: plan generation returns structured Zod-validated task list, UI renders an editable preview, confirm triggers real `createTask` calls.
- Testing: test that `generateProjectPlan` never persists directly; test `createTask` tool enforces the same authorization as the REST route.
- Commit: "feat: AI-generated task plans with user confirmation".
- Done when: user can type a feature description and get real, editable tasks created after one confirm click.

**Phase 16 — AI Usage Logging & Guardrails**
- Goal: `AIUsage` table populated, per-user rate limiting on AI endpoints.
- Files: `modules/ai/usage`, `lib/rate-limit.ts`.
- Steps: log every model call (tokens, tool used), Redis-based rate limiter on `/ai/*` routes.
- Testing: test that exceeding the limit returns 429; test usage rows are created.
- Commit: "feat: AI usage logging and rate limiting".
- Done when: AI usage is tracked and abusive request volume is throttled.

**Phase 17 — Background Jobs (Redis/BullMQ)**
- Goal: move embedding generation and notification fan-out off the request path.
- Files: `lib/queue.ts`, `jobs/`.
- Steps: introduce Redis + BullMQ, migrate embedding generation to a job, add a worker process/entry point.
- Testing: integration test that saving a doc enqueues a job and the job produces embeddings.
- Commit: "feat: background job queue for embeddings and notifications".
- Done when: doc save returns instantly and embeddings appear shortly after via the worker.

**Phase 18 — updateTask / deleteTask Tools + Confirmation Flow**
- Goal: destructive/mutating AI tools with mandatory server-side confirmation.
- Files: `modules/ai/tools`, `components/ai-chat/confirm-card`.
- Steps: two-phase tool execution (propose → confirm token → execute), UI confirm card.
- Testing: test that execution without a valid confirm token is rejected server-side even if the model "says" the user agreed.
- Commit: "feat: AI update/delete tools with mandatory confirmation".
- Done when: AI can update or delete a task only after an explicit, server-verified user confirmation.

**Phase 19 — Analytics (Phase 2 feature, own phase)**
- Goal: project analytics dashboard (throughput, cycle time, AI usage).
- Files: `modules/analytics`, `getProjectAnalytics` tool.
- Steps: aggregate queries (cached in Redis), charts, expose as an AI tool too.
- Testing: test aggregate correctness against seeded data.
- Commit: "feat: project analytics dashboard".
- Done when: charts reflect real project data and the AI can answer analytics questions via the tool.

**Phase 20 — Real-Time Updates**
- Goal: live board updates across sessions.
- Tech: WebSockets (Pusher/Ably or self-hosted).
- Files: `lib/realtime.ts`.
- Steps: publish events on task mutation, subscribe on the board.
- Testing: manual multi-tab test; unit test event payload shape.
- Commit: "feat: real-time task board updates".
- Done when: a task moved in one tab updates instantly in another.

**Phase 21 — File Attachments**
- Goal: attach files to tasks/docs.
- Tech: S3/R2, signed URLs.
- Files: `modules/uploads`.
- Steps: signed upload flow, virus/type validation, attachment UI.
- Testing: test rejecting disallowed file types/oversized files.
- Commit: "feat: file attachments via object storage".
- Done when: files can be uploaded/downloaded securely and never served directly from the app server.

**Phase 22 — Testing & Hardening Pass**
- Goal: close testing gaps before wider release.
- Steps: raise coverage on services/tools, add E2E suite for all core flows, run `/security-review`, fix findings.
- Testing: this phase is testing.
- Commit: "test: expand coverage and security hardening".
- Done when: CI enforces meaningful coverage and the security review has no open criticals.

**Phase 23 — Production Deployment**
- Goal: live production deployment.
- Steps: provision managed Postgres/Redis, configure Vercel envs, set up Sentry, domain + HTTPS, smoke test in prod.
- Testing: production health check, manual smoke test of core flows.
- Commit: "chore: production deployment configuration".
- Done when: the real domain serves the app and core flows work end-to-end in production.

**Phase 24 — AI Agent Workflows (Advanced)**
- Goal: multi-step tool-calling chains with a plan-then-execute UI.
- Steps: agent loop with a bounded step count, visible plan the user approves before any step executes, per-step logging.
- Testing: test the loop halts on max steps / on any unconfirmed destructive step.
- Commit: "feat: controlled multi-step AI agent workflows".
- Done when: a multi-step request (e.g., "triage these 5 tasks") executes only after an approved plan, with every step audited.

**Phase 25 — Integrations & Public API (Future)**
- Goal: GitHub import, API keys for external access.
- Steps: OAuth app for GitHub, issue import mapping to Task, API key issuance + scoped auth for `/api/v1`.
- Testing: integration tests for imported data mapping and API key auth.
- Commit: "feat: GitHub integration and public API keys".
- Done when: issues can be imported from a connected GitHub repo and external clients can call the API with a scoped key.

## 23. Git/GitHub Strategy

- `main` is always deployable; work happens on short-lived feature branches per phase (`phase-06-tasks-board`).
- One PR per phase (or per meaningful sub-step within a large phase); PR description states goal + testing done.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`) as used in the phase list above.
- CI (lint/typecheck/test/build) required to pass before merge.
- Tag a release (`v0.1.0`, etc.) at the end of each major phase group (MVP complete, Phase 2 complete, ...).

## 24. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | One framework for FE+BE, RSC for perf, accessible unstyled primitives, fast styling |
| State/data | React Query + Zustand (minimal) | Server-state caching without a heavy global store |
| Backend | Next.js Route Handlers (modular monolith) | Avoids premature microservices; clean seam to extract later |
| Database | PostgreSQL + Prisma | Mature, typed, migration-friendly; pgvector support for RAG without a separate vector DB |
| Cache/Queue | Redis (Upstash) + BullMQ | Rate limiting, caching, background jobs without new infra class |
| AI | Vercel AI SDK + Anthropic Claude (primary) | Provider-agnostic, first-class streaming + tool-calling + structured output |
| Validation | Zod | Single schema source for API, forms, and AI tool args |
| Auth | Auth.js | Self-hosted control over sessions/roles, OAuth support |
| Hosting | Vercel (app) + Neon/Supabase (Postgres+pgvector) + Upstash (Redis) | Solo-dev-friendly, scales, minimal ops |
| Testing | Vitest + Playwright | Fast unit/integration + real E2E |
| Observability | Sentry + pino + Vercel Analytics | Errors, structured logs, perf, minimal setup |

Deliberately excluded for now: separate microservices, a dedicated vector database (pgvector suffices at this scale), Kubernetes, GraphQL (REST is simpler for this surface area), a separate mobile app.

## 25. Risks and Trade-offs

- **AI cost/latency risk**: mitigated by usage logging, rate limits, and keeping non-conversational tasks (embeddings) on cheaper models.
- **Prompt injection via docs/tasks**: mitigated by the tool-mediated architecture and treating retrieved content as data, never instructions — but requires ongoing vigilance as more tools are added.
- **Modular monolith may need splitting later** if AI workloads (embedding generation, agent loops) grow heavy — mitigated by keeping the service layer decoupled from route handlers now so extraction is mechanical, not a rewrite.
- **Solo-developer bandwidth**: the 25-phase plan is ambitious; MVP (through Phase 11) is the honest first milestone, everything after is genuinely "future."
- **Vendor lock-in on managed services** (Vercel/Neon/Upstash): acceptable trade-off for solo-dev velocity; all are replaceable since the app talks to them via standard protocols (Postgres wire protocol, Redis protocol).

## 26. Definition of a Production-Ready DevPilot AI

- All MVP features (§7) work end-to-end in production for real signed-up users, with no local-only shortcuts.
- Every write path is authorized and audited, including every AI tool call.
- No AI tool can bypass the authorization layer that REST routes use — verified by tests, not just code review.
- Core flows have E2E coverage; CI blocks merges on failing tests.
- The app has monitoring (errors + uptime) and the developer would know within minutes if it went down.
- Secrets are never in source control; a fresh clone + `.env` can run the app.
- The UI meets the design goals in §9 on both desktop and mobile, in light and dark themes, without motion that ignores `prefers-reduced-motion`.
- Data backups exist and a restore has been tested at least once.

---

## Master Build Roadmap (Concise)

1. **Foundation** (Phases 0–3): scaffold, database, auth, profile.
2. **Core PM product** (Phases 4–10): projects, RBAC, tasks/board, comments/activity, notifications, docs, dashboard.
3. **Product polish** (Phase 11): landing page, design-system pass — MVP UI complete.
4. **AI core** (Phases 12–16): chat, read tools, RAG, write tools with confirmation, usage/rate-limiting — MVP AI complete. **→ MVP ships here.**
5. **Scale-up infra** (Phases 17–21): background jobs, destructive-tool confirmation flow, analytics, real-time, attachments.
6. **Harden & launch** (Phases 22–23): testing/security pass, production deployment.
7. **Advanced AI** (Phase 24): multi-step controlled agent workflows.
8. **Ecosystem** (Phase 25): integrations, public API.

No code, dependencies, or files beyond this document have been touched. Next step, when ready: Phase 0 (project scaffold).
