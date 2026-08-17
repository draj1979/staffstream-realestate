# Deploying Staffstream to Cloud Run

One-time setup, run in order. Everything here is `gcloud`/`gsutil` — copy,
fill in the placeholders, paste. Re-running most of these commands is safe
(idempotent) if something fails partway and you retry.

This deploys a **single Cloud Run service** running the whole Next.js app
(UI + API + WhatsApp webhook + cron endpoint) — no microservices, no
separate OpenClaw process. See the note at the top of the
[Dockerfile](./Dockerfile) for why: Phase 4 settled on spawning
`openclaw agent --local` as a short-lived subprocess per conversation
turn rather than a persistent Gateway daemon, so there's nothing to run
alongside `next start` in the container.

## 0. Variables and one-time gcloud setup

Export these once per terminal session — every command below reuses them.

```bash
export PROJECT_ID="angular-unison-476906-s5"
export REGION="asia-south1"                    # Mumbai
export SERVICE_NAME="staffstream"
export AR_REPO="staffstream"                    # Artifact Registry repo name
export SQL_INSTANCE="staffstream-db"
export SQL_DB_NAME="staffstream"
export SQL_DB_USER="staffstream"
export SQL_DB_PASSWORD="<CHOOSE-A-STRONG-DB-PASSWORD>"      # placeholder — fill in
export GCS_BUCKET="${PROJECT_ID}-staffstream-brochures"     # must be globally unique
export RUN_SA_NAME="staffstream-run"
export RUN_SA_EMAIL="${RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud auth login
gcloud config set project "$PROJECT_ID"
```

## a. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

(`artifactregistry.googleapis.com` isn't in the original list but is
required — Cloud Build pushes the built image to Artifact Registry, not
the legacy Container Registry, on current GCP projects.)

## b. Cloud SQL for PostgreSQL

Smallest tier suitable for an MVP (`db-f1-micro`, shared-core, ~0.6GB
RAM) — bump this before real production load.

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_17 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-size=10GB \
  --storage-type=SSD \
  --no-assign-ip

gcloud sql databases create "$SQL_DB_NAME" --instance="$SQL_INSTANCE"

gcloud sql users create "$SQL_DB_USER" \
  --instance="$SQL_INSTANCE" \
  --password="$SQL_DB_PASSWORD"
```

`--no-assign-ip`: no public IP — Cloud Run reaches it exclusively via the
Cloud SQL Auth Proxy connection Cloud Run manages natively (§e), so a
public IP isn't needed and is one less thing exposed to the internet.

Note the instance's connection name for later steps:

```bash
export SQL_CONNECTION_NAME=$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')
echo "$SQL_CONNECTION_NAME"   # looks like PROJECT_ID:REGION:staffstream-db
```

## c. Cloud Storage bucket for brochure PDFs

Private, uniform bucket-level access — matches `lib/gcs.ts`'s assumption
that objects aren't public (documents are served by downloading them
server-side, never via a public URL).

```bash
gcloud storage buckets create "gs://${GCS_BUCKET}" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access
```

## d. Secret Manager

Create the service account first, then the secrets, then grant it access
to each one individually (least privilege — this SA can read exactly
these 8 secrets, nothing else).

```bash
gcloud iam service-accounts create "$RUN_SA_NAME" \
  --display-name="Staffstream Cloud Run service"
```

Build the production `DATABASE_URL` (Unix-socket form, for the Cloud SQL
Auth Proxy connection — see §e):

```bash
export DATABASE_URL="postgresql://${SQL_DB_USER}:${SQL_DB_PASSWORD}@localhost/${SQL_DB_NAME}?host=/cloudsql/${SQL_CONNECTION_NAME}"
```

Create each secret (fill in the placeholder values first — these are the
same values you already have in your local `.env.local`, except
`DATABASE_URL`, which is different in production, and `CRON_SHARED_SECRET`,
which is new — generate one with e.g. `openssl rand -hex 24`):

```bash
printf '%s' "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=-

printf '%s' "<YOUR-ANTHROPIC-API-KEY>" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
printf '%s' "<YOUR-WHATSAPP-ACCESS-TOKEN>" | gcloud secrets create WHATSAPP_ACCESS_TOKEN --data-file=-
printf '%s' "<YOUR-WHATSAPP-PHONE-NUMBER-ID>" | gcloud secrets create WHATSAPP_PHONE_NUMBER_ID --data-file=-
printf '%s' "<YOUR-WHATSAPP-APP-SECRET>" | gcloud secrets create WHATSAPP_APP_SECRET --data-file=-
printf '%s' "<CHOOSE-A-WHATSAPP-VERIFY-TOKEN>" | gcloud secrets create WHATSAPP_VERIFY_TOKEN --data-file=-
printf '%s' "<GENERATE-32+-RANDOM-CHARS>" | gcloud secrets create SESSION_SECRET --data-file=-
printf '%s' "<GENERATE-A-RANDOM-SECRET>" | gcloud secrets create CRON_SHARED_SECRET --data-file=-
```

Grant the Cloud Run service account read access to each:

```bash
for SECRET in DATABASE_URL ANTHROPIC_API_KEY WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID \
              WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN SESSION_SECRET CRON_SHARED_SECRET; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${RUN_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor"
done
```

Also grant the service account Cloud SQL Client (for the native
connection) and object access on the brochure bucket:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUN_SA_EMAIL}" \
  --role="roles/cloudsql.client"

gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${RUN_SA_EMAIL}" \
  --role="roles/storage.objectAdmin"
```

## e. Build, push, and deploy

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Staffstream container images"

export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

gcloud builds submit --tag "$IMAGE" .
```

Deploy — secrets map `<SECRET_NAME>=<env var name>`; note
`CRON_SHARED_SECRET` (the Secret Manager resource name) is deliberately
mapped to the `CRON_SECRET` env var, which is what the app's code
(`app/api/cron/followups/route.ts`) actually reads:

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$RUN_SA_EMAIL" \
  --add-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production,OPENCLAW_WORKSPACE_PATH=/app/.openclaw-workspace,GCS_BUCKET_NAME=${GCS_BUCKET},GCS_PROJECT_ID=${PROJECT_ID}" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,WHATSAPP_ACCESS_TOKEN=WHATSAPP_ACCESS_TOKEN:latest,WHATSAPP_PHONE_NUMBER_ID=WHATSAPP_PHONE_NUMBER_ID:latest,WHATSAPP_APP_SECRET=WHATSAPP_APP_SECRET:latest,WHATSAPP_VERIFY_TOKEN=WHATSAPP_VERIFY_TOKEN:latest,SESSION_SECRET=SESSION_SECRET:latest,CRON_SECRET=CRON_SHARED_SECRET:latest"
```

`--allow-unauthenticated` is required — the WhatsApp webhook and the cron
endpoint are called by Meta/Cloud Scheduler over plain HTTP, not Google
IAM-authenticated requests. Both are protected by their own app-level
checks instead (HMAC signature, shared secret — see
[SECURITY.md](./SECURITY.md)); the dashboard/API routes are separately
protected by the session cookie.

`--min-instances=0` means cold starts between requests (fine for MVP
traffic; this is a big image — see the note in the Dockerfile's header —
so expect a slower first request after idle). Bump to `1` if that's not
acceptable once real usage starts.

Note the deployed URL:

```bash
export SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')
echo "$SERVICE_URL"
```

## f. Run the Prisma migration

**Do not run `prisma migrate dev` against production** — it can prompt
to reset data. Use `prisma migrate deploy` (applies pending migrations
only, no prompts, no shadow database needed), via a one-off Cloud Run Job
using the exact same image:

```bash
gcloud run jobs create "${SERVICE_NAME}-migrate" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$RUN_SA_EMAIL" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
  --command="npx" \
  --args="prisma,migrate,deploy" \
  --max-retries=0

gcloud run jobs execute "${SERVICE_NAME}-migrate" --region="$REGION" --wait
```

Re-run `gcloud run jobs execute ... --wait` any time you deploy a new
image with new migrations — `migrate deploy` only applies what's pending,
so it's safe to run repeatedly.

Seed the builder admin the same way, once, after the first migration
(replace the two secret values with real ones — this only needs to run
once, so it's fine to pass them as one-off env vars rather than
provisioning permanent secrets for them):

```bash
gcloud run jobs create "${SERVICE_NAME}-seed-admin" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$RUN_SA_EMAIL" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
  --set-env-vars="ADMIN_EMAIL=<YOUR-ADMIN-EMAIL>,ADMIN_PASSWORD=<CHOOSE-A-STRONG-PASSWORD>" \
  --command="npx" \
  --args="tsx,scripts/seed-admin.ts" \
  --max-retries=0

gcloud run jobs execute "${SERVICE_NAME}-seed-admin" --region="$REGION" --wait
```

Delete the seed-admin job afterward if you'd rather not leave a
plaintext password sitting in a job definition:

```bash
gcloud run jobs delete "${SERVICE_NAME}-seed-admin" --region="$REGION" --quiet
```

**Alternative** (if you'd rather not use a Cloud Run Job): connect via
the Cloud SQL Auth Proxy locally —
`cloud-sql-proxy "$SQL_CONNECTION_NAME"` in one terminal, then in another,
with `DATABASE_URL` pointed at `localhost` instead of `/cloudsql/...`, run
`npx prisma migrate deploy` from your machine.

## g. Cloud Scheduler — automated follow-ups

Every 2 hours, calls the cron endpoint with the shared secret header.
Replace `<CRON-SHARED-SECRET-VALUE>` with the same value you put in the
`CRON_SHARED_SECRET` Secret Manager secret in §d.

```bash
gcloud scheduler jobs create http "${SERVICE_NAME}-followups" \
  --location="$REGION" \
  --schedule="0 */2 * * *" \
  --uri="${SERVICE_URL}/api/cron/followups" \
  --http-method=POST \
  --headers="X-Cron-Secret=<CRON-SHARED-SECRET-VALUE>" \
  --attempt-deadline=300s
```

## h. Point WhatsApp's webhook at the deployed service

Manual step, in the [Meta App Dashboard](https://developers.facebook.com/apps/):

1. Open your app → **WhatsApp** → **Configuration**.
2. Set **Callback URL** to `${SERVICE_URL}/api/webhooks/whatsapp` (the
   real value of `$SERVICE_URL` from §e — e.g.
   `https://staffstream-xxxxx-el.a.run.app/api/webhooks/whatsapp`).
3. Set **Verify token** to the same value you put in the
   `WHATSAPP_VERIFY_TOKEN` secret in §d.
4. Click **Verify and save** — Meta calls `GET` on that URL with the
   token; the deployed service should respond and Meta will confirm.
5. Under **Webhook fields**, subscribe to `messages`.

## Redeploying after a code change

```bash
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy "$SERVICE_NAME" --image="$IMAGE" --region="$REGION"
gcloud run jobs execute "${SERVICE_NAME}-migrate" --region="$REGION" --wait   # if the migration has new files
```
