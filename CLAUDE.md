# Staffstream

## Project purpose

Staffstream is a single-tenant SaaS MVP: an AI sales agent for **one** real
estate builder that talks to inbound leads over **WhatsApp**. The agent
answers questions about the builder's projects using the builder's brochure
content and helps qualify/nurture leads.

## MVP scope (read this before adding anything)

This is intentionally narrow. Build only what's needed for:

- **One builder, one WhatsApp Business number.** There is no notion of
  multiple builder accounts or multiple WhatsApp numbers in this phase.
- **PDF-only knowledge base.** The builder uploads brochure PDFs. Extracted
  text is the only knowledge source — no other document types for now.
- **No vector DB / RAG.** Brochure text is small enough to paste directly
  into the agent's context; agent runtime is OpenClaw, calling Gemini as the
  model (`google/gemini-3.1-flash-lite` — see lib/agent/workspace.ts; was
  Claude through earlier phases, switched on direct request). Do not
  introduce a vector store, embeddings, or a retrieval layer unless a
  future phase explicitly asks for it.
- **No multi-tenant isolation.** There is one builder, so there's no
  tenant_id partitioning, no per-tenant auth scoping, no data isolation
  concerns to design for yet.

If a task seems to require any of the above, stop and confirm scope before
building it — it's likely out of scope for this MVP.

## Tech stack

- **Next.js (App Router) + TypeScript** — single app, both UI and API.
- **Prisma + PostgreSQL** — all persistence.
- **Google Cloud Storage** — stores uploaded PDF brochures.
- **OpenClaw (agent runtime) + Google Gemini API (model)** — powers the
  WhatsApp sales agent conversation.
- **Deployment target: Cloud Run.**
- **Architecture note:** OpenClaw is used as an in-process library from our
  own WhatsApp webhook (official WhatsApp Cloud API) — we do NOT use
  OpenClaw's built-in WhatsApp channel connector. See Phase 4/5 for why.

## Coding conventions

- API routes live under `app/api/`.
- Server-only secrets (API keys, tokens, DB credentials) are read only in
  server-side code (route handlers, server components, server actions) and
  must never be exposed to the client — don't prefix them `NEXT_PUBLIC_`,
  don't pass them into client components.
- All database access goes through Prisma. No raw SQL string
  concatenation — use Prisma's query API, or parameterized `$queryRaw`
  tagged templates if raw SQL is unavoidable.
- All external input (webhook payloads, form submissions, API request
  bodies/query params) is validated with `zod` before use.

## Explicit non-goals for this MVP

Do not build these unless a future task explicitly asks for them:

- Multi-tenancy (multiple builders/accounts)
- RBAC beyond a single logged-in builder admin
- CRM integrations (Salesforce, HubSpot, etc.)
- Voice or other messaging channels beyond WhatsApp
- Dynamic pricing logic
