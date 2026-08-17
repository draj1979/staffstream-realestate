# Qwen3.5-9B inference service

A standalone, self-hosted OpenAI-API-compatible inference endpoint for
`Qwen3.5-9B`, running on Cloud Run with an NVIDIA L4 GPU. This is
**infrastructure only** — nothing in the Staffstream app calls it yet.
**Phase 11 needs them** (this service's URL + auth pattern, documented
below) to wire it in as a model backend. Until then it sits idle-but-warm
behind Cloud Run IAM, serving no traffic.

This is a second, independent Cloud Run *service* (not a VM, not part of
the main `staffstream` service) in the same GCP project
(`angular-unison-476906-s5`).

## Model, quantization and context-length decision

| Decision | Choice | Why |
|---|---|---|
| Model | `Qwen/Qwen3.5-9B` architecture | Requested by the task; 9B dense model, native context 262,144 tokens (extensible to ~1M), has a vision encoder. |
| Checkpoint | **`RedHatAI/Qwen3.5-9B-quantized.w4a16`** (INT4 W4A16, via LLM Compressor / compressed-tensors) | Quantized checkpoint from Red Hat / Neural Magic, who maintain the compressed-tensors format vLLM uses natively — vLLM auto-detects the quantization from the checkpoint's `config.json`, no `--quantization` flag needed. ~11GB on disk vs ~19.3GB for the unquantized BF16 checkpoint. A third-party deploy guide for the *unquantized* BF16 model reported needing to cap `--max-model-len` to 16384–24576 even on an 80GB H100 to fit comfortably — on a single 24GB L4 the unquantized checkpoint would leave almost no room for KV cache. The quantized checkpoint (~11GB weights) leaves ~9GB+ of the L4's 24GB for KV cache/activations at `--gpu-memory-utilization 0.85`, which is comfortable at the context length below. This follows the task's own default: "an INT4/AWQ-quantized checkpoint if a well-supported one exists." |
| Context length | `--max-model-len 8192` | Far below the model's native 262K, but generous for a WhatsApp sales-agent turn (the task's own suggested cap). Keeps KV cache small and predictable on a single L4; can be raised later with load-testing if a future integration needs longer context. |
| GPU memory utilization | `--gpu-memory-utilization 0.85` | Conservative headroom on the L4's 24GB, per the task's own suggested value. |
| Reasoning/tool flags | `--reasoning-parser qwen3`, `enable_thinking: false` by default, `--enable-auto-tool-choice --tool-call-parser qwen3_coder` | Thinking is off by default to keep responses short/fast for a chat use case (can be re-enabled via the chat template kwarg on a per-request basis later if Phase 11 wants reasoning traces). Tool-calling is enabled proactively since this project's whole agent architecture (OpenClaw + 5 registered tools) is tool-call-heavy — if Phase 11 does swap this in as the OpenClaw model backend it'll need working tool calls. `qwen3_coder` is the parser name documented on the Qwen3.5 model card for this family's tool-call output format (not specific to a "coder" model variant). |

### Region: `asia-southeast1`, not `asia-south1`

The main app (`staffstream`) runs in `asia-south1` (Mumbai). Cloud Run
GPU support in `asia-south1` is **invitation-only** ("Contact your Google
Account team if you are interested in this region," per Google's own
Cloud Run GPU docs, checked live this session). We have no such
invitation. `asia-southeast1` (Singapore) has **generally-available**
Cloud Run GPU support, so this service is deployed there instead, per the
task's own pre-authorized fallback.

**This means Phase 11's calls from the main app to this service cross
regions** (asia-south1 → asia-southeast1). That's a modest latency cost
(Mumbai↔Singapore, typically ~30-50ms RTT) worth knowing about, but not
prohibitive for a chat-turn use case. If `asia-south1` GPU access is
later granted, this service could be redeployed there to remove the
cross-region hop — nothing about the app-level integration would need to
change beyond the service URL.

### Bleeding-edge dependency — known risk

As of this writing (2026-08), Qwen3.5's `qwen3_5` model architecture is
**not supported in any stable vLLM release** — vLLM 0.16.0 stable does not
recognize it. The Dockerfile installs vLLM from its **nightly** wheel
index (`--pre` from `https://wheels.vllm.ai/nightly`), which:

- Is not pinned to a specific nightly build/date — a rebuild of this image
  in the future will pull whatever nightly is current *at that time*,
  which could differ in behavior from what was tested at initial deploy.
  If you need a fully reproducible rebuild later, pin to a specific dated
  nightly package version (`pip index versions vllm --pre --extra-index-url
  https://wheels.vllm.ai/nightly` to find one) rather than an open `--pre`
  range.
- Also requires forcing `transformers>=5.0.0` after vLLM's own install,
  since vLLM nightly still defaults to a `transformers<5` pin that
  conflicts with Qwen3.5's requirements.
- Has **not been functionally tested end-to-end** by this deploy — Docker
  build validity was checked (image builds and installs cleanly), but
  actually serving a real inference request requires a GPU, which isn't
  available in this local dev environment. The first real functional test
  happens against the live Cloud Run service post-deploy (DEPLOY.md step
  covers this: `/v1/models` and a real completion request).

If a future stable vLLM release adds first-class Qwen3.5 support, switch
the Dockerfile back to a pinned stable `vllm==X.Y.Z` release and drop the
nightly index / transformers override.

## Authentication pattern (for Phase 11)

This service is deployed with `--no-allow-unauthenticated` — Cloud Run
rejects any request without a valid Google-signed identity token for a
principal that has `roles/run.invoker` on it. There is a second,
independent auth layer inside the container: vLLM's own `--api-key`,
sourced from the `QWEN_INFERENCE_API_KEY` Secret Manager secret.

**Phase 11 needs both layers** when calling from the main app:

```ts
// 1. Fetch a Google-signed identity token scoped to this service's URL,
//    from the Cloud Run metadata server (works automatically on Cloud
//    Run/GCE — no service account key file needed).
const idTokenRes = await fetch(
  `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${QWEN_SERVICE_URL}`,
  { headers: { "Metadata-Flavor": "Google" } }
);
const idToken = await idTokenRes.text();

// 2. Call the OpenAI-compatible endpoint with BOTH the ID token
//    (Cloud Run access control) and the vLLM API key (app-level auth).
const res = await fetch(`${QWEN_SERVICE_URL}/v1/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${idToken}`,
    "X-Api-Key": process.env.QWEN_INFERENCE_API_KEY!, // or vLLM's expected header — see note below
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model: "qwen3.5-9b", messages: [...] }),
});
```

Note: vLLM's OpenAI server expects its `--api-key` as a **second**
`Authorization: Bearer <key>` value in the OpenAI-client convention (the
official `openai` SDK's `apiKey` option sends it as `Authorization: Bearer
<key>` too) — since Cloud Run's own ID-token check also wants
`Authorization: Bearer <id-token>`, these two can't both live in the same
header. The practical options for Phase 11 to resolve this when it's
built: (a) put the ID token in `Authorization` and the vLLM key in a
custom header, then confirm whether vLLM's server can be configured to
read the key from a different header; or (b) terminate the Cloud Run
IAM check via the platform (already done here) and treat the vLLM
`--api-key` as the sole per-request credential the app code sends in
`Authorization`, relying on `roles/run.invoker` + the identity token only
implicitly (Cloud Run still enforces it at the platform level even if the
app code's `Authorization` header is "used" for the vLLM key instead —
Cloud Run's ingress check happens before the request reaches the
container, using the token Cloud Run itself validates, which needs to be
the actual bearer token Cloud Run's front end inspects, not an
application-level substitute). **This header collision needs to be
resolved and tested as part of Phase 11's implementation** — flagging it
now rather than guessing at an unverified answer.

- **Service URL**: recorded in DEPLOY.md's output after first deploy —
  format `https://qwen-inference-<hash>-as.a.run.app`.
- **`QWEN_INFERENCE_API_KEY`**: stored in Secret Manager as
  `qwen-inference-api-key`; the main app's service account needs
  `roles/secretmanager.secretAccessor` on it if Phase 11 wants the app to
  read it directly (not yet granted — do this when Phase 11 starts).

## Cost

This is an always-warm GPU instance (`--min-instances=1`), unlike
everything else deployed for this project so far. See DEPLOY.md for the
concrete monthly estimate before deploying — this is a materially larger,
ongoing cost commitment than the rest of the stack and worth confirming
before running the deploy step.
