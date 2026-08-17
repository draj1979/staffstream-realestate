# Manual QA checklist — end-to-end, against the deployed environment

Run this against the live Cloud Run deployment (see [DEPLOY.md](./DEPLOY.md)
for the URL), not local dev. Nothing here should require an application
code change — if a check fails, that's a bug to file, not something to
patch as part of running this checklist.

## 1. Dashboard: create a project, upload a brochure

1. Log into `/login` with the seeded admin credentials.
2. `/dashboard/projects` → **New Project** → fill in name/address (RERA
   optional) → **Create project**.
3. Open the new project → upload a real brochure PDF.
4. Confirm the document row shows **PROCESSING**, then flips to **READY**
   within roughly 10–30 seconds (the page polls automatically).

**Pass condition:** document reaches READY status without a manual
refresh, and reflects a real project.

## 2. First WhatsApp message

From a real phone (not previously in the system), message the configured
WhatsApp Business number: **"Hi"**.

**Pass condition:** a natural greeting reply arrives within a few
seconds, introducing the project by name — not a generic/canned response,
not silence.

## 3. Stated requirement → follow-up questions → site visit offer

Continue the same conversation: describe a requirement, e.g. *"looking
for a 3 BHK around 1.5 Cr"*. Keep replying naturally to whatever it asks
next (budget/purpose/timeline etc.) until it proposes a site visit.

**Pass condition:** the agent asks sensible, one-at-a-time follow-up
questions (not a bulk interrogation), doesn't re-ask anything already
stated, and — once it has enough of a sense of fit — proactively offers
concrete site visit slots without needing to be asked.

## 4. Brochure request

Somewhere in the conversation, ask: *"can you send me the brochure"*.

**Pass condition:** the PDF itself arrives as a WhatsApp **document**
message (not just a text reply saying it will), matching the brochure
uploaded in check 1.

## 5. Confirm a site visit

Pick one of the offered slots and confirm it.

**Pass condition:**
- The lead's entry in `/dashboard/leads` shows stage **SITE_VISIT
  SCHEDULED** (the solid green badge).
- The admin notification fires — check Cloud Logging for an `[ALERT]
  Site visit confirmed` entry (see [SECURITY.md](./SECURITY.md) — this is
  a log line, not an email, by design for this MVP).

## 6. Out-of-scope question → no invention

From a **different** WhatsApp number (a fresh lead), ask something the
brochure clearly doesn't cover — e.g. about a different, unrelated
project, or a specific loan/legal detail.

**Pass condition:** the agent does not invent an answer. It either hands
off (dashboard shows stage **HANDED OFF** with a reason) or plainly says
it doesn't have that information — never a confident-sounding guess.

## 7. Automated follow-up, exactly once

Leave a lead idle (no reply) past the configured follow-up window
(`FOLLOWUP_THRESHOLD_HOURS`, default 24h) — or temporarily lower it for
testing via the Cloud Run service's env vars, trigger
`POST /api/cron/followups` (manually or via the Cloud Scheduler job), then
restore the original value afterward.

**Pass condition:** exactly one re-engagement message arrives, referencing
what's already known about the lead (not a generic "still there?"). The
lead's `lastContactedAt` updates and stage becomes **FOLLOWUP**. Running
the cron again immediately after does *not* send a second message (the
lead is no longer stale).

## 8. Webhook signature rejection

Directly, via `curl` (no real phone involved):

```bash
curl -i -X POST "<SERVICE_URL>/api/webhooks/whatsapp" \
  -H "Content-Type: application/json" \
  -d '{"entry":[]}'
# no X-Hub-Signature-256 header at all

curl -i -X POST "<SERVICE_URL>/api/webhooks/whatsapp" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"entry":[]}'
```

**Pass condition:** both return **401**, and no `Lead`/`Message`/
`Conversation` row gets created from either request (check the DB or the
leads table before/after).

## Filing a failure

For anything that fails, capture: which check, the exact input sent, the
actual vs. expected output, and — if it's conversational — the full
message transcript. Cloud Logging (filtered to the Cloud Run service) has
the `[webhooks/whatsapp]`/`[cron/followups]`/`[ALERT]` log lines used
throughout this checklist.
