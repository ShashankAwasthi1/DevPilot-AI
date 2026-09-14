# ADR 0001: Separate Express + TypeScript backend instead of Next.js API routes

## Status

Accepted (reflects a decision already in effect since Phase 2; recorded retroactively during Phase 11).

## Context

`BLUEPRINT.md` (§15 Frontend Architecture, §16 Backend Architecture, §21 Deployment Strategy,
§24 Recommended Tech Stack) describes DevPilot AI as a Next.js modular monolith: the frontend
and backend living in the same Next.js app, with backend logic implemented as Next.js API
routes / route handlers under `modules/*`.

Starting with Phase 2 (Authentication), the actual implementation instead uses a standalone
Express + TypeScript backend (`server/`), separate from the Next.js client (`client/`), talking
over HTTP with a cross-origin, credentialed, cookie-based session. This has been the real
architecture through Phase 10 and was never reconciled with the BLUEPRINT text.

## Decision

Keep the two-service architecture:

```
Next.js frontend (client/)
   → Express + TypeScript backend (server/)
      → Prisma
         → PostgreSQL (Neon)
```

Routes → middleware (`requireAuth`, `validate`) → controllers → services → Prisma, as already
implemented in `server/src/`. The frontend calls the backend via a typed fetch wrapper
(`client/lib/api.ts`) with `credentials: "include"`, not via Next.js server actions or
same-origin API routes.

This ADR does not change the architecture - it documents the one already running in production
code, so future phases (starting with Phase 12's AI provider layer) are planned against reality
instead of the original BLUEPRINT assumption.

## Consequences

- Phase 12+ AI endpoints (chat, tools, RAG) will live in `server/`, not in a Next.js
  `modules/ai` route-handler tree as BLUEPRINT originally described.
- Deployment (BLUEPRINT §21) will need two deployable units instead of one Vercel deployment:
  the Next.js client (Vercel-friendly as-is) and the Express backend (needs its own Node
  host - e.g. Render/Fly/Railway - rather than Vercel serverless functions).
- The layering BLUEPRINT §16 asks for (`route → validate → authorize → service → Prisma`, one
  shared source of truth for business logic) is already satisfied - it's just realized inside
  `server/` rather than inside the Next.js app.
- BLUEPRINT.md §14, §15, §16, §21, and §24 are not rewritten as part of this ADR. They remain
  as original planning context and should be revisited and updated deliberately in a future
  documentation pass, not silently patched alongside unrelated feature work.
