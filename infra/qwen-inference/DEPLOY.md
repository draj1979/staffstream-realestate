# Deploy runbook: `qwen-inference` (Qwen3.5-9B, Cloud Run + L4 GPU)

This is a **document, not a script** — run each command yourself, in
order, checking the output between steps. See `README.md` for the
model/quantization/region decision this runbook implements.

## Before you run this

This deploys an **always-warm GPU instance** (`--min-instances=1`), which
is a materially larger recurring cost than anything else deployed for
this project. Rough estimate at the time of writing, `asia-southeast1`,
on-demand (non-committed) Cloud Run GPU pricing:

- 1x NVIDIA L4 GPU, billed per-second while the instance is up: ~US$0.67/hr
  → ~US$482/month running continuously.
- The vCPU + memory Cloud Run requires alongside the GPU (Cloud Run's GPU
  tier needs a minimum instance shape, typically 4-8 vCPU / 16-32GB for an
  L4 service) adds roughly another US$100-250/month on top, depending on
  the shape you pick below.
- **Total: roughly US$550-750/month**, before any actual inference
  traffic (traffic adds request-time compute, not more GPU-hours, since
  the GPU is already always-on).

This is an estimate from public pricing, not a quote — confirm against
the [Cloud Run pricing page](https://cloud.google.com/run/pricing) and
your project's actual billing before committing. Nothing in the app
currently calls this service (it's pre-built infrastructure for a future
phase), so this cost starts accruing with no offsetting product usage
until that integration lands.

**Do not run step (b) below (the actual `gcloud run deploy` with
`--gpu`) until you've confirmed you want to start this cost.** Steps (a)
can be run any time — building and pushing the image costs nothing
ongoing.

## Prerequisites

```bash
export PROJECT_ID="angular-unison-476906-s5"
export REGION="asia-southeast1"          # NOT asia-south1 — see README.md
export REPO="staffstream-images"          # reuse the main app's Artifact Registry repo, or create a new one
export IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT_ID}/${REPO}/qwen-inference:latest"
export SERVICE="qwen-inference"
export MAIN_APP_SERVICE_ACCOUNT="staffstream-run@${PROJECT_ID}.iam.gserviceaccount.com"  # confirm the exact SA used by the `staffstream` service
```

If `${REPO}` doesn't already exist in `${REGION}` (it likely doesn't —
the main app's Artifact Registry repo is in `asia-south1`), create a
region-local one so the image push/pull doesn't cross regions:

```bash
gcloud artifacts repositories create "$REPO" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --repository-format=docker
```

## (a) Build and push the image

GPU-dependent Python wheels make this a large image (~10-15GB with CUDA
base + vLLM + the model's runtime deps — the model weights themselves are
downloaded at container startup from Hugging Face, not baked into the
image). Use Cloud Build rather than a local `docker build` for a
consistent build environment and to avoid pushing a multi-GB image over a
local connection:

```bash
gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --tag="$IMAGE" \
  "infra/qwen-inference"
```

This can take a while (CUDA base image + vLLM nightly install). Watch for
the build to finish successfully before continuing.

## (b) Create the vLLM API key secret

```bash
export QWEN_API_KEY=$(openssl rand -hex 32)
echo -n "$QWEN_API_KEY" | gcloud secrets create qwen-inference-api-key \
  --project="$PROJECT_ID" \
  --data-file=- \
  --replication-policy=automatic
```

(If the secret already exists from a prior attempt, use
`gcloud secrets versions add qwen-inference-api-key --data-file=-` instead.)

Save `$QWEN_API_KEY` somewhere safe (e.g. your password manager) — Phase
11 will need it to call this service. It is not retrievable in plaintext
from Secret Manager after this step except by users/service accounts with
`secretAccessor` on it.

## (c) Deploy the Cloud Run service — THE STEP THAT STARTS BILLING

Re-read the cost section above before running this.

**Known blocker (as of 2026-08-17, this project):** deploying with `--gpu=1`
in `asia-southeast1` currently fails with:

```
ERROR: (gcloud.run.deploy) spec.template.metadata.annotations[autoscaling.knative.dev/maxScale]:
You do not have quota for using GPUs with zonal redundancy. ...
You do not have quota for using GPUs without zonal redundancy. ...
To request quota: g.co/cloudrun/gpu-quota
```

This project has **zero Cloud Run GPU quota** in this region — for both
`run.googleapis.com/nvidia_l4_gpu_allocation` (zonal redundant) and
`run.googleapis.com/nvidia_l4_gpu_allocation_no_zonal_redundancy`. This
is unrelated to the CPU/memory quota also enforced on this project
(`CpuAllocPerProjectRegion` was capped at 20 vCPU / `MemAllocPerProjectRegion`
at 40GiB in this region at the time of writing — the shape below is sized
to fit under that, but even a correctly-sized request still needs GPU
quota granted separately).

**This requires a manual quota increase request, submitted by the project
owner**, before step (c) can succeed:

1. Go to [Cloud Console → IAM & Admin → Quotas](https://console.cloud.google.com/iam-admin/quotas?project=angular-unison-476906-s5), filter by service `Cloud Run Admin API` and metric containing `nvidia_l4_gpu`.
2. Or use the direct request flow at `g.co/cloudrun/gpu-quota`.
3. Request quota for `asia-southeast1` (the non-zonal-redundant metric is
   sufficient — that's what `--no-gpu-zonal-redundancy` below uses, and
   it's the cheaper of the two categories). A request for 1 GPU is enough
   to run this single always-warm instance.
4. Google's approval time for GPU quota varies (sometimes minutes,
   sometimes longer) — there's no way to force or predict it from here.

Once the quota is granted, re-run the command below — nothing else about
this runbook changes.

```bash
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$IMAGE" \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu=8 \
  --memory=32Gi \
  --min-instances=1 \
  --max-instances=1 \
  --concurrency=4 \
  --no-cpu-throttling \
  --no-allow-unauthenticated \
  --timeout=600 \
  --set-secrets="QWEN_INFERENCE_API_KEY=qwen-inference-api-key:latest"
```

Notes:
- `--max-instances=1` (not 2-3 as originally envisioned) because this
  project's `CpuAllocPerProjectRegion`/`MemAllocPerProjectRegion` quota in
  `asia-southeast1` was 20 vCPU / 40GiB at the time of writing — an 8
  vCPU / 32GiB shape only fits one instance under that ceiling. Combined
  with `--min-instances=1` this means the service can't autoscale at all
  right now; it's a single fixed instance. Request higher CPU/memory
  quota alongside the GPU quota above if Phase 11 needs real headroom.
- `--no-gpu-zonal-redundancy` — the cheaper of the two GPU quota
  categories (see the quota blocker note above); use this unless you
  specifically request and get zonal-redundant quota instead.
- `--concurrency=4` is a starting guess, not a measured number — vLLM can
  batch multiple requests per GPU, but the right concurrency depends on
  prompt/response length and needs load-testing before relying on it in
  production. Revisit once there's real traffic (Phase 11).
- `--no-cpu-throttling` keeps the CPU active between requests, which
  vLLM's async scheduler benefits from — Cloud Run's default
  throttle-when-idle behavior can otherwise stall GPU-backed services.
- `--timeout=600` gives headroom for the first request after a cold
  start (model load from Hugging Face + CUDA graph compilation can take
  minutes) — subsequent requests on a warm instance are fast.
- No `--set-env-vars` needed for the model/quant/context settings — the
  Dockerfile's `ENV` defaults already match the decision in README.md.
  Override with `--set-env-vars` here only if you want to change them for
  this deploy specifically.

## (d) Grant the main app's service account invoker access

```bash
gcloud run services add-iam-policy-binding "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --member="serviceAccount:${MAIN_APP_SERVICE_ACCOUNT}" \
  --role="roles/run.invoker"
```

## (e) Verify

Get the service URL:

```bash
export QWEN_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')
echo "$QWEN_URL"
```

**Authenticated request should succeed** (list models — confirms the
container booted, vLLM loaded the model, and Cloud Run's IAM check
passed):

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$QWEN_URL/v1/models" | head -c 1000
```

Expect a JSON body listing `qwen3.5-9b` (the `--served-model-name` set in
the Dockerfile). If this is the first request after deploy, it may take
several minutes (cold start: pulling ~11GB of model weights from Hugging
Face, then CUDA graph compilation) — Cloud Run will hold the request open
up to the `--timeout=600` set above rather than failing fast, so a slow
first response isn't necessarily a bug.

**Unauthenticated request should be rejected**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$QWEN_URL/v1/models"
```

Expect `403` (Cloud Run's own IAM rejection, before the request ever
reaches the container).

**Full round-trip with the vLLM-level API key** (once you have `$QWEN_URL`
and the identity token, and want to confirm real inference works, not
just the health/models endpoint):

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  "$QWEN_URL/v1/chat/completions" \
  -d '{
    "model": "qwen3.5-9b",
    "messages": [{"role": "user", "content": "Say hello in one short sentence."}]
  }'
```

Note this test call doesn't pass the vLLM `--api-key` — see the header
collision note in README.md's auth section. If vLLM rejects it with a 401
once you resolve that (i.e. it's actually enforcing the key, not just
accepting all requests that pass Cloud Run's IAM check), that confirms
the second auth layer is active; work out the correct header scheme as
part of Phase 11.

## Rollback / cleanup

If this needs to come back down (e.g. cost review, or the model choice
changes):

```bash
gcloud run services delete "$SERVICE" --project="$PROJECT_ID" --region="$REGION"
```

This stops all billing for the service immediately (Cloud Run GPU
billing is per-second while the service has running instances). The
`qwen-inference-api-key` secret and the Artifact Registry image are not
deleted by this — remove them separately with `gcloud secrets delete` /
`gcloud artifacts docker images delete` if you want a full teardown.
