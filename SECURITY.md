# Security

Staffstream is a single-tenant MVP for one real estate builder. This
document is a snapshot of what's covered and what's deliberately deferred —
proportional to that scope, not a general-purpose SaaS security posture.
See [CLAUDE.md](./CLAUDE.md) for the project's overall scope.

## What's covered

### 1. Input validation & database access

Every API route that touches the database validates untrusted input with
`zod` before use — request bodies (`app/api/auth/login`,
`app/api/projects`), path params (`app/api/projects/[id]/documents`,
`app/api/leads/[id]/handoff`), and the WhatsApp webhook payload shape
(`lib/whatsapp/webhook.ts`, including a length cap on message text). All
database access goes through Prisma's query API — there is no raw SQL
string interpolation anywhere in the codebase (`$queryRaw`/`$executeRaw`
are unused).

### 2. Webhook & cron authentication

- `POST /api/webhooks/whatsapp` verifies the `X-Hub-Signature-256` header
  (HMAC-SHA256 over the raw request body, keyed by `WHATSAPP_APP_SECRET`,
  compared with a timing-safe comparison) as the very first thing the
  handler does — before any database read or write. An invalid/missing
  signature returns 401 immediately.
- `POST /api/cron/followups` requires an `X-Cron-Secret` header matching
  `CRON_SECRET` (timing-safe comparison), checked before any database
  query. This endpoint is called by Cloud Scheduler, not a browser — it's
  intentionally excluded from session-cookie auth in `proxy.ts` and uses
  its own shared-secret check instead.

### 3. Sessions & passwords

- Session cookies (`iron-session`, see `lib/session-config.ts`) are
  `httpOnly`, `secure` in production (`NODE_ENV === "production"`),
  `sameSite: "lax"`, and signed/encrypted with `SESSION_SECRET` (32+
  chars, enforced at startup) — the cookie value is not readable or
  forgeable from client JS.
- Passwords are only ever handled as bcrypt hashes. The single builder
  admin's plaintext password is read once, by `scripts/seed-admin.ts`,
  solely to hash it — never stored or logged. Login compares with
  `bcrypt.compare`, including a dummy-hash comparison when the email
  doesn't exist, so a nonexistent account doesn't respond measurably
  faster than a wrong password. No password or password hash is ever
  passed to `console.*` anywhere in the codebase.

### 4. PDF upload validation & storage

`POST /api/projects/[id]/documents` rejects uploads that fail *any* of:
extension (`.pdf`), MIME type (`application/pdf`/absent), actual file
size (20MB cap, checked server-side before reading the whole file into
memory), and file magic bytes (`%PDF-`) — extension/MIME headers are
client-supplied and can be spoofed, so the magic-byte check is the one
that can't be. Stored objects live at
`documents/{projectId}/{uuid}-{sanitizedFilename}.pdf` in GCS — a
non-guessable path, not the original filename alone, and the filename
itself is sanitized to strip path separators and unsafe characters before
use.

### 5. Rate limiting

Basic in-memory fixed-window limiting (`lib/rateLimit.ts`):

- `POST /api/auth/login`: 10 attempts / 5 minutes per client IP.
- `POST /api/webhooks/whatsapp`: 20 inbound messages / 5 minutes per
  WhatsApp sender number.

This blunts obvious abuse (credential stuffing, a single sender spamming
the endpoint and running up Claude API costs) — it is explicitly not a
WAF. It's per-process state, so on a multi-instance Cloud Run deployment
the effective limit is `limit × instance count`, not a hard global cap.
Fine for this MVP's traffic; an Upstash/Redis-backed limiter is the
upgrade path if that ever matters.

### 6. Secrets hygiene

All secrets (`ANTHROPIC_API_KEY`, `WHATSAPP_*`, `SESSION_SECRET`,
`CRON_SECRET`, `DATABASE_URL`, GCS project/bucket config) live only in
`.env.local` (gitignored) or as placeholders in `.env.example`. A repo
scan for API-key-shaped strings (`sk-ant-…`, `EAA…`, connection strings
with embedded credentials, etc.) outside those two files came back clean.
`.gitignore` excludes `.env*` with an explicit `!.env.example` carve-out.

### 7. Security headers

Set globally via `next.config.ts`: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options:
DENY`, a restrictive `Permissions-Policy`, and a best-effort
`Content-Security-Policy`. The CSP is intentionally not a strict
nonce-based policy — the app uses React inline `style={{...}}` throughout
and Next.js's own hydration script, so `script-src`/`style-src` allow
`'unsafe-inline'` (with `'unsafe-eval'` further scoped to non-production
only, since React's dev build needs it for stack traces and production
never does). It still restricts remote script/object sources,
clickjacking (`frame-ancestors 'none'`), and base-tag/form-action
injection.

## Explicitly out of scope for this MVP

These are deliberate scope decisions for a single-tenant MVP serving one
builder, not oversights:

- **No WAF / Cloud Armor** — rate limiting above is the only abuse
  mitigation; no bot detection, geo-blocking, or DDoS protection layer.
- **No formal penetration test or third-party security audit.**
- **No audit logging beyond Cloud Logging** — `console.log`/`console.error`
  output is the only trail (see also the per-route logging notes in
  earlier phases); no dedicated append-only audit log, no log-tampering
  protection.
- **No MFA** — the single builder admin logs in with email + password
  only.
- **No CSRF token** — mitigated only by `SameSite: "lax"` on the session
  cookie, which covers the realistic cross-site attack surface here
  (no state-changing `GET` routes, no cross-origin form posting target).
  A dedicated CSRF token would be the next step if this app ever grows a
  public-facing form flow beyond the builder's own dashboard.
- **No dependency vulnerability scanning automation** — `npm audit` is
  run manually, not wired into CI. (`openclaw`'s own transitive
  dependencies currently show some known advisories — see prior phase
  notes; nothing actionable on our side beyond staying current with
  OpenClaw releases.)
- **No encryption-at-rest configuration beyond cloud provider defaults**
  — relies on Cloud SQL/GCS's default encryption, not customer-managed
  keys.
- **No secret rotation automation** — rotating `SESSION_SECRET`,
  `CRON_SECRET`, API keys, etc. is a manual operational task.
- **Single-tenant by design** — no tenant isolation, no per-tenant auth
  scoping; see CLAUDE.md. Not a security gap, a scope boundary.
