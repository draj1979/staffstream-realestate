# CI/CD (GitHub Actions -> Cloud Run)

One-time setup, run once by you (creating a service account + granting
IAM roles is outside what I run automatically). After this is done,
every push to `main` on
[draj1979/staffstream-realestate](https://github.com/draj1979/staffstream-realestate)
builds the image, applies pending Prisma migrations, and deploys to
Cloud Run automatically — see
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

This mirrors the manual `gcloud` flow in [DEPLOY.md](DEPLOY.md) §e/§f —
same image, same migrate job, same `gcloud run deploy` — just triggered
by a push instead of by hand.

## 1. Create the CI service account and grant it deploy permissions

```bash
export PROJECT_ID="angular-unison-476906-s5"
export SA_NAME="staffstream-github-deploy"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --project "$PROJECT_ID" \
  --display-name="GitHub Actions deploy (staffstream-realestate)"

# run.admin: deploy the Cloud Run service + update/execute the migrate job.
# artifactregistry.writer: push built images.
# iam.serviceAccountUser: required to deploy/execute *as* the app's own
#   runtime service account (staffstream-run@...), which both the Cloud
#   Run service and the migrate job already run as.
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None
done
```

This is scoped to exactly what the workflow does — it cannot read
Secret Manager values, touch Cloud SQL data, or reach the GCS bucket;
those stay on `staffstream-run`, the app's own runtime identity, which
this CI service account only gets to deploy/run *as*, not act as itself.

## 2. Create a key and store it as a GitHub secret

A long-lived key was the deliberate choice here over Workload Identity
Federation, for simpler one-time setup — which means it's on you to
rotate it periodically (e.g. every 90 days: create a new key, update the
secret, delete the old key) and to revoke it immediately if it's ever
exposed.

```bash
gcloud iam service-accounts keys create /tmp/staffstream-github-deploy-key.json \
  --iam-account="$SA_EMAIL"

gh secret set GCP_SA_KEY \
  --repo draj1979/staffstream-realestate \
  < /tmp/staffstream-github-deploy-key.json

rm /tmp/staffstream-github-deploy-key.json   # don't leave the key on disk
```

## 3. Done

Push to `main` (or re-run manually from the Actions tab — the workflow
also has `workflow_dispatch`) and watch it run at
https://github.com/draj1979/staffstream-realestate/actions.

## Rotating or revoking the key

```bash
# List existing keys (to find the old one's KEY_ID before deleting it)
gcloud iam service-accounts keys list --iam-account="$SA_EMAIL"

# Revoke a compromised/old key
gcloud iam service-accounts keys delete <KEY_ID> --iam-account="$SA_EMAIL"
```
