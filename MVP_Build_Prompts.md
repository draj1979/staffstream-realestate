# Staffstream MVP — Claude Code Build Playbook

A narrow, single-tenant MVP of the AI Real Estate Sales Agent. This document is written to be used **with Claude Code** (the CLI) — paste each phase as a prompt, in order, into a Claude Code session in your project repo. Each phase builds on the last.

**Scope reminder (deliberately narrow):** one builder, one or more projects under that builder, no multi-tenant isolation, WhatsApp-only, PDF-only knowledge source, one LLM provider (Claude), basic auth instead of full RBAC, deploy to your own GCP project.

---

## 0. Before you open Claude Code — manual prerequisites

Claude Code can write and deploy all the code, but a few things only you can set up (external accounts, not code):

1. **GCP project** — create one (or pick an existing one), note the Project ID, and make sure billing is enabled. Install and auth the `gcloud` CLI locally (`gcloud auth login`, `gcloud config set project <PROJECT_ID>`).
2. **Anthropic API key** — from the Anthropic Console. This MVP calls Claude directly (no model-router abstraction — that's intentionally out of scope for the MVP; see §10).
3. **WhatsApp Cloud API access** — a Meta Business App with the WhatsApp product added, a test (or production) phone number, and:
   - a permanent **access token**
   - the **phone number ID**
   - an **app secret** (used to verify webhook signatures)
   - a **webhook verify token** you choose yourself (any random string)
   This is a manual setup in Meta's App Dashboard — Claude Code can't do this part, but it can write all the integration code once you have these values.
4. A GitHub (or other git) repo for the project, empty, cloned locally — this is where Claude Code will work.

Keep all of the above values handy; Phase 0 below will ask you to drop them into a local `.env` file (never committed).

---

## 1. Recommended stack (why, in one line each)

- **Next.js (TypeScript, App Router)** — one deployable app for both the builder dashboard (pages) and the backend (API routes/webhook), which minimizes moving parts for a solo-founder MVP.
- **PostgreSQL on Cloud SQL + Prisma ORM** — one managed database, type-safe queries, easy migrations.
- **Cloud Storage** — stores the uploaded brochure PDFs.
- **Anthropic Claude API (Messages API + tool use)** — the conversation engine. Called directly, no provider-abstraction layer (that's a Phase-2 concern once you need multiple builders/models).
- **No vector database.** A single brochure (or a handful of them for one project) fits comfortably inside Claude's context window. The MVP extracts the PDF text once and injects it directly into the system prompt — this is deliberately simpler than a RAG/embeddings pipeline and is the right trade-off at this scale (see §10 for when to revisit).
- **Cloud Run** — hosts the Next.js app (dashboard + API + WhatsApp webhook) as one service.
- **Cloud Scheduler** — triggers the follow-up job on a timer (e.g. every 2 hours) by calling a protected API route.
- **Secret Manager** — holds the Anthropic key, WhatsApp tokens, DB URL, and session secret.

---

## 2. Data model (for reference — Phase 1 below has Claude Code generate this as a Prisma schema)

- `User` — builder login (email, password hash). No roles/permissions table needed for MVP; if you log in, you're the builder.
- `Project` — name, address, RERA number (optional), status.
- `Document` — the uploaded brochure: project_id, file name, GCS path, extracted_text, uploaded_at, status (processing/ready/failed).
- `Lead` — whatsapp_number, name (once known), project_id, stage (NEW / GREETED / QUALIFYING / QUALIFIED / FOLLOWUP / SITE_VISIT_SCHEDULED / HANDED_OFF / LOST), requirement fields (configuration, budget, purpose, timeline — nullable, filled in as the conversation progresses), created_at, last_contacted_at.
- `Conversation` — lead_id, messages (either its own `Message` table or a JSON array — a `Message` table is cleaner for the follow-up job to query).
- `Message` — conversation_id, direction (inbound/outbound), body, created_at.
- `SiteVisit` — lead_id, proposed_slots (JSON), confirmed_slot, status (proposed/confirmed/completed/cancelled).

---

## 3. The build sequence

Paste these prompts into Claude Code **in order**, in an empty repo. Wait for each phase to finish (and sanity-check the result) before starting the next — don't paste all of them at once.

### Phase 0 — Project scaffold + CLAUDE.md

```
Set up a new Next.js 14+ project (TypeScript, App Router, Tailwind CSS) for a single-tenant SaaS MVP called "Staffstream". This is an AI sales agent for a real estate builder that talks to leads over WhatsApp.

Do the following:
1. Scaffold the Next.js app in the repo root.
2. Add Prisma with a PostgreSQL datasource (don't define models yet — that's the next phase).
3. Create a `.env.example` file listing (with placeholder values and a one-line comment each):
   DATABASE_URL, ANTHROPIC_API_KEY, GCS_BUCKET_NAME, GCS_PROJECT_ID,
   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
   WHATSAPP_VERIFY_TOKEN, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH
4. Create a `.gitignore` that excludes `.env`, `.env.local`, `node_modules`, and build output.
5. Create a `CLAUDE.md` file at the repo root with these project instructions for future sessions:
   - Project purpose and the narrow MVP scope (single builder, single WhatsApp number, PDF-only knowledge, no multi-tenant isolation, no vector DB — full brochure text goes directly into the Claude system prompt).
   - Tech stack: Next.js App Router + TypeScript, Prisma + PostgreSQL, Cloud Storage, Anthropic Claude API, deployed on Cloud Run.
   - Coding conventions: API routes under app/api/, server-only secrets never exposed to the client, all DB access through Prisma (no raw SQL string concatenation), all external input validated with zod before use.
   - Explicit non-goals for this MVP: no multi-tenancy, no RBAC beyond a single logged-in builder, no CRM integrations, no voice/other channels, no dynamic pricing.
6. Add a README.md with setup instructions (install deps, copy .env.example to .env.local, run prisma migrate, run dev server).

Acceptance criteria: `npm run dev` starts a blank Next.js app with no errors; CLAUDE.md and README.md exist and read cleanly; .env is gitignored.
```

### Phase 1 — Database schema

```
Using Prisma, define the following models in schema.prisma and generate a migration:

- User: id, email (unique), passwordHash, createdAt
- Project: id, name, address, reraNumber (nullable), status (enum: DRAFT, ACTIVE, ARCHIVED, default ACTIVE), createdAt
- Document: id, projectId (FK), fileName, gcsPath, extractedText (Text, nullable), status (enum: PROCESSING, READY, FAILED), uploadedAt
- Lead: id, projectId (FK), whatsappNumber (unique per project — add a compound unique on projectId+whatsappNumber), name (nullable), stage (enum: NEW, GREETED, QUALIFYING, QUALIFIED, FOLLOWUP, SITE_VISIT_SCHEDULED, HANDED_OFF, LOST, default NEW), configuration (nullable string), budget (nullable string), purpose (nullable string), timeline (nullable string), createdAt, lastContactedAt (nullable)
- Conversation: id, leadId (FK, 1:1 with Lead), createdAt
- Message: id, conversationId (FK), direction (enum: INBOUND, OUTBOUND), body (Text), createdAt
- SiteVisit: id, leadId (FK), proposedSlots (Json, nullable), confirmedSlot (DateTime, nullable), status (enum: PROPOSED, CONFIRMED, COMPLETED, CANCELLED, default PROPOSED), createdAt

Add sensible indexes (leadId on Message/SiteVisit via Conversation, projectId on Lead/Document, stage on Lead for the follow-up job's queries). Run the migration against DATABASE_URL from .env.local and confirm it applies cleanly. Generate the Prisma client.

Acceptance criteria: `npx prisma migrate dev` succeeds; `npx prisma studio` shows all six tables with the fields above.
```

### Phase 2 — Auth + dashboard shell

```
Build a minimal authentication flow for a single builder user (no signup flow needed — the one admin user is seeded via a script):

1. Add a `scripts/seed-admin.ts` that creates a User from ADMIN_EMAIL and a bcrypt hash of ADMIN_PASSWORD (read a plaintext ADMIN_PASSWORD env var only for the seed script, never store or log it elsewhere).
2. Implement session-based login: POST /api/auth/login checks email+password against the User table with bcrypt.compare, and on success sets a signed, httpOnly session cookie (use `iron-session` or equivalent) containing the user id. POST /api/auth/logout clears it.
3. Add a `/login` page (email + password form, plain and functional, no styling polish needed yet).
4. Add a middleware that protects everything under /dashboard/** and /api/** (except /api/auth/login, /api/webhooks/**, and /api/cron/**) — unauthenticated requests to protected routes get redirected to /login (pages) or 401 (API).
5. Add a bare /dashboard layout with a left nav listing: Overview, Projects, Leads (we'll fill these in later phases) and a logout button.

Acceptance criteria: visiting /dashboard while logged out redirects to /login; logging in with the seeded admin credentials reaches /dashboard; the session cookie is httpOnly and not readable from client JS.
```

### Phase 3 — Project + brochure upload pipeline

```
Build the project management and brochure ingestion flow:

1. /dashboard/projects — list projects, "New Project" form (name, address, RERA number optional). Create via a server action or API route, validated with zod.
2. /dashboard/projects/[id] — project detail page showing project info and its uploaded documents (name, status, uploaded date), plus an upload form (PDF only, max 20MB — validate both extension/MIME and size server-side, not just client-side).
3. POST /api/projects/[id]/documents — accepts a PDF upload, uploads it to the GCS bucket (path convention: documents/{projectId}/{uuid}-{filename}.pdf), creates a Document row with status PROCESSING, then kicks off text extraction (see next point). Return immediately with the created Document so the UI can poll/show status; don't block the HTTP response on extraction.
4. Text extraction: use a PDF text-extraction library (e.g. `pdf-parse`) to pull all text from the uploaded PDF, store it in Document.extractedText, and set status to READY. If extraction fails or yields near-empty text (likely a scanned/image-only PDF), set status to FAILED and store a short reason — surface this clearly in the UI ("This PDF appears to be scanned/image-based and couldn't be read — OCR isn't supported in this MVP; try a text-based export of the brochure.").
5. On the project detail page, poll document status every few seconds while any document is PROCESSING and update the UI when it flips to READY/FAILED.

Acceptance criteria: uploading a normal text-based PDF brochure ends with a READY document whose extractedText contains the brochure's content; uploading a scanned/image-only PDF ends with a clear FAILED status and message instead of silently producing garbage.
```

### Phase 4 — The Claude conversation engine (core agent logic)

```
Build the core agent logic as a standalone, testable module (not yet wired to WhatsApp — that's next phase). Put it in lib/agent/.

1. lib/agent/systemPrompt.ts — a function buildSystemPrompt(project, documentText) that returns the system prompt for Claude. It must instruct the model to:
   - Act as a professional, consultative real-estate sales executive for the named project — natural conversation, not a menu-driven bot, one question at a time.
   - Answer only from the supplied project brochure text (included verbatim in the prompt) plus any structured lead info already captured — never invent pricing, availability, RERA details, or possession dates that aren't in the brochure text.
   - Greet a first-time sender, ask what they're looking for, and progressively learn: configuration, budget, purpose (self-use/investment), and timeline — without interrogating; a natural back-and-forth.
   - Always be working toward one goal: get the lead to agree to and confirm a site visit. Once a site visit is confirmed, the AI's job is done and a human should take over — it should not keep chatting past that point except to confirm logistics.
   - Offer to send the brochure PDF whenever it's relevant or asked for.
   - If asked something outside the brochure's scope, or if the lead asks for a human, or becomes a strong negotiation/complaint case, hand off rather than guessing.
2. lib/agent/tools.ts — define these tool schemas for Claude's tool-use API:
   - update_lead_info(configuration?, budget?, purpose?, timeline?, name?) — updates the Lead row with whatever fields are provided.
   - propose_site_visit(slots: string[]) — records proposed slots on the SiteVisit row (creating it if needed) and returns them so the model can present them to the user.
   - confirm_site_visit(slot: string) — sets SiteVisit.confirmedSlot and status CONFIRMED, and moves Lead.stage to SITE_VISIT_SCHEDULED.
   - request_brochure() — signals that the brochure PDF should be sent as a WhatsApp document (the caller sends the actual file; this tool just signals intent + returns the GCS path).
   - handoff_to_human(reason: string) — sets Lead.stage to HANDED_OFF and records the reason (used both for "site visit confirmed" and "needs a human for another reason", e.g. explicit request, out-of-scope question, negotiation).
3. lib/agent/runTurn.ts — the main entry point: runTurn(leadId, inboundMessageText) => { replyText, toolEffects }. It should:
   - Load the Lead, its Project, the Project's latest READY Document, and the full Message history for the conversation.
   - Call the Claude Messages API (claude-sonnet-4-5 or newer) with the system prompt, the full message history, the new inbound message, and the tool definitions.
   - Execute any tool calls the model makes against the database, then (per Anthropic's tool-use loop) return the tool results to the model and get its final reply text.
   - Persist both the inbound and outbound Message rows, and update Lead.stage/last fields based on which tools ran.
   - Return the final reply text (and a flag if a document/brochure should be sent) to the caller.

Write this as pure, testable functions — no WhatsApp-specific code here. Include a small script or test that calls runTurn with a fake lead/message and prints the result, so we can sanity check the conversation logic before wiring up WhatsApp.

Acceptance criteria: running the test script against a seeded project+document+lead produces a sensible, on-brief greeting response for a first message like "Hi, I'm looking for a 3 BHK", and correctly calls update_lead_info with the captured requirement.
```

### Phase 5 — WhatsApp Cloud API integration

```
Wire the agent engine from Phase 4 up to WhatsApp Cloud API:

1. GET /api/webhooks/whatsapp — implements Meta's webhook verification handshake (checks hub.verify_token against WHATSAPP_VERIFY_TOKEN, echoes hub.challenge).
2. POST /api/webhooks/whatsapp — receives inbound message events:
   - Verify the request signature using the X-Hub-Signature-256 header and WHATSAPP_APP_SECRET (reject with 401 if it doesn't match — this is the main anti-spoofing control for this endpoint).
   - Parse the sender's WhatsApp number and message text.
   - Find or create the Lead (by projectId + whatsappNumber — for this MVP, route all inbound messages to a single default/active Project; note this clearly in a code comment as an MVP simplification to revisit if the builder ever runs more than one active project+number).
   - Find or create the Conversation for that Lead.
   - Call lib/agent/runTurn with the inbound text.
   - Send the reply back via the WhatsApp Cloud API (POST to the phone number's /messages endpoint with WHATSAPP_ACCESS_TOKEN). If runTurn signals a brochure should be sent, also send the PDF as a WhatsApp document message (upload via WhatsApp's media endpoint, referencing the file from GCS).
   - Always return 200 quickly to Meta (do the actual work synchronously for MVP simplicity, but keep it fast — no unnecessary waiting).
3. Add a small lib/whatsapp/client.ts wrapping the two calls above (send text, send document) so they're not duplicated.
4. Log inbound/outbound events (message id, lead id, timestamp) to console/Cloud Logging — don't log full message bodies containing personal data at info level; keep that at debug level only if you add one.

Acceptance criteria: sending "Hi" from a real WhatsApp number to the configured test number results in a logged inbound event, a Lead+Conversation created, and a greeting reply arriving back on WhatsApp within a few seconds. Sending a request with a tampered/missing signature is rejected with 401 and does not touch the database.
```

### Phase 6 — Follow-up job + human handoff surfacing

```
Add the follow-up automation and make handoffs visible to the builder:

1. POST /api/cron/followups — protected by a shared secret header (not the session cookie — this is called by Cloud Scheduler, not a browser). Logic:
   - Find all Leads with stage in (GREETED, QUALIFYING, QUALIFIED, FOLLOWUP) where lastContactedAt is more than N hours ago (make N configurable via env, default 24) and stage is not HANDED_OFF/LOST/SITE_VISIT_SCHEDULED.
   - For each, generate a short, natural follow-up message via the Claude agent (reuse the system prompt + lead context — a lighter prompt variant asking it to write one brief re-engagement message referencing what's already known about the lead) and send it via WhatsApp.
   - Update lastContactedAt and move stage to FOLLOWUP if it wasn't already.
   - Cap the number of automated follow-ups per lead (e.g. stop after 4) and mark stage LOST if the lead never responds after that — record this in a followupCount field (add it to the Lead model via a migration).
2. Dashboard: /dashboard/leads — a table of all leads across projects: name/number, project, stage, last contacted, with the stage shown as a colored badge (make SITE_VISIT_SCHEDULED and HANDED_OFF visually distinct — these are the ones that need the builder's attention).
3. /dashboard/leads/[id] — full conversation thread (read-only) for that lead, plus current requirement fields and site visit status, and a manual "Mark as handed off" button for the builder to override if needed.
4. (Optional but recommended, keep simple) When a lead's stage flips to SITE_VISIT_SCHEDULED or HANDED_OFF, send a plain email to ADMIN_EMAIL via a lightweight transactional email API (or log clearly to Cloud Logging as a fallback if you'd rather not add an email dependency yet) so the builder notices without having to keep the dashboard open.

Acceptance criteria: a lead with no reply for >24h receives exactly one follow-up message and its stage/lastContactedAt update; the leads table correctly reflects stage changes; the conversation detail page renders the full thread in order.
```

### Phase 7 — Security pass

```
Do a focused security review and hardening pass over the whole app — this should be lightweight, proportional to a single-tenant MVP (no over-engineering):

1. Confirm every API route that touches the database validates its input with zod before use, and that Prisma is used for all queries (no raw SQL string interpolation anywhere).
2. Confirm the WhatsApp webhook signature check (Phase 5) is applied before any DB write, and that the cron endpoint (Phase 6) rejects requests without the correct shared secret.
3. Confirm session cookies are httpOnly, secure (in production), and signed; confirm passwords are only ever handled as bcrypt hashes, never logged.
4. Confirm the PDF upload route enforces both file size and MIME-type/extension checks server-side, and that uploaded files are stored under a non-guessable GCS path (uuid-based, not the original filename alone).
5. Add basic rate limiting to the WhatsApp webhook and login routes (a simple in-memory or Upstash/Redis-based limiter is fine — the goal is to blunt obvious abuse, not build a WAF).
6. Confirm no secrets (API keys, tokens, DB URL) exist anywhere in the repo outside .env.local/.env.example, and that .env.local is gitignored.
7. Add security headers (Content-Security-Policy is optional/best-effort for MVP, but do add X-Content-Type-Options: nosniff and a reasonable Referrer-Policy) via next.config.js.
8. Write a short SECURITY.md summarizing what's covered above and explicitly noting what's intentionally out of scope for this MVP (e.g. no WAF/Cloud Armor, no formal pen test, no audit logging beyond Cloud Logging, no MFA) so it's a documented decision, not an oversight.

Acceptance criteria: a code review pass confirms all 7 points above; SECURITY.md exists and accurately reflects the app's current state.
```

### Phase 8 — Dockerize + deploy to GCP

```
Prepare and deploy the app to my GCP project (project ID: <YOUR_GCP_PROJECT_ID>, region: <YOUR_REGION, e.g. asia-south1>):

1. Add a production Dockerfile (multi-stage: build the Next.js app, run it with `next start` in a slim node image) and a .dockerignore.
2. Write out (as a markdown file, DEPLOY.md, not as code you run yourself) the exact sequence of gcloud commands I need to run once, in order, to:
   a. Enable required APIs: run.googleapis.com, sqladmin.googleapis.com, secretmanager.googleapis.com, storage.googleapis.com, cloudscheduler.googleapis.com, cloudbuild.googleapis.com.
   b. Create a Cloud SQL for PostgreSQL instance (smallest tier suitable for an MVP), a database, and a user.
   c. Create the Cloud Storage bucket for brochure PDFs (private, uniform bucket-level access).
   d. Create Secret Manager secrets for DATABASE_URL, ANTHROPIC_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, SESSION_SECRET, CRON_SHARED_SECRET, and grant the Cloud Run service account access to read them.
   e. Build and push the container image with Cloud Build, and deploy it to Cloud Run with the Cloud SQL instance attached (via the Cloud SQL Auth Proxy connection Cloud Run supports natively) and the secrets mounted as env vars.
   f. Run the Prisma migration against the production database (document how to do this safely — e.g. a one-off Cloud Run job or connecting via the Cloud SQL proxy locally).
   g. Create a Cloud Scheduler job that calls POST /api/cron/followups every 2 hours with the CRON_SHARED_SECRET header.
   h. Point the WhatsApp app's webhook URL (in the Meta App Dashboard — manual step, just document it) at the deployed Cloud Run URL's /api/webhooks/whatsapp.
3. Keep this to a single Cloud Run service (the whole Next.js app) — don't split into microservices for this MVP.

Acceptance criteria: DEPLOY.md contains a complete, ordered, copy-pasteable command sequence with placeholders clearly marked for me to fill in (project ID, region, DB password, etc.); the Dockerfile builds successfully with `docker build .` locally.
```

### Phase 9 — End-to-end smoke test

```
Write a short manual QA checklist (as TESTING.md) covering the full flow end to end against the deployed environment:

1. Log into the dashboard, create a project, upload a real brochure PDF, confirm it reaches READY status.
2. From a real phone, message the WhatsApp number "Hi" — confirm a greeting arrives within a few seconds.
3. Continue the conversation describing a requirement (e.g. "looking for a 3 BHK around 1.5 Cr") — confirm the agent asks sensible follow-up questions and eventually offers site visit slots.
4. Ask "can you send me the brochure" — confirm the PDF arrives as a WhatsApp document.
5. Confirm a site visit slot — confirm the lead's dashboard entry shows stage SITE_VISIT_SCHEDULED and the admin notification fires.
6. Ask a question clearly outside the brochure's content (e.g. about a different, unrelated project) — confirm the agent doesn't invent an answer and instead hands off or says it doesn't have that information.
7. Leave a lead idle for the configured follow-up window (or temporarily lower the threshold for testing) — confirm exactly one follow-up message arrives.
8. Send a request with a bad/missing WhatsApp signature directly via curl — confirm it's rejected with 401 and nothing is written to the database.

Do NOT change any application code as part of this phase — this is a verification pass only. Report back which of the 8 checks pass and any that fail with enough detail to file as a follow-up bug.
```

---

## 10. Deliberate MVP simplifications — and what "Phase 2" looks like later

These are intentional scope cuts for this MVP, called out so they're a decision, not a surprise:

- **Single Claude provider, no model router.** If you later want the AI model configurable (as in the full HLD), that's a wrapper module around the one `runTurn` call — small change, not a rebuild.
- **No vector DB / embeddings.** Works well while each project has one (or a few) brochures that fit in context. If a project accumulates many documents or very long ones, revisit with pgvector or Vertex AI Vector Search, as in the full HLD.
- **Single WhatsApp number / single active project routing.** The MVP webhook doesn't yet route by destination number. The moment you have two live projects on two numbers, this needs a small routing table (WhatsApp number → project).
- **No multi-tenant isolation.** Fine for one builder running their own instance. Do not reuse this codebase as-is for multiple builders without adding tenant scoping first (see the full HLD's multi-tenancy section).
- **Basic auth, single admin user.** No roles, no sales-manager/sales-executive distinction yet.
- **No CRM integrations, no campaign attribution, no analytics dashboard beyond the leads table.**

These map directly to "Phase 2" in the earlier HLD document (`HLD_Real_Estate_AI_SaaS.docx`) — worth re-reading once this MVP is working and you're deciding what to build next.
