# Qwen3.5-9B inference service — OpenAI-API-compatible vLLM server for
# Cloud Run + NVIDIA L4 GPU. See README.md for the model/quantization/region
# decision and DEPLOY.md for the deploy runbook.
#
# IMPORTANT: as of this writing (2026-08), Qwen3.5's `qwen3_5` architecture
# is NOT in any stable vLLM release (0.16.0 stable does not recognize it).
# We install vLLM from its nightly wheel index. Nightly wheels are not
# pinned to a specific build here — see the "known risk" note in README.md
# under "Bleeding-edge dependency" before doing a from-scratch rebuild in
# production; re-verify with `docker build` + a smoke test on a real GPU
# before rolling out a rebuilt image.

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3.11-venv python3-pip git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python

RUN python3 -m pip install --no-cache-dir --upgrade pip

# vLLM nightly build — required for Qwen3.5 (`qwen3_5`) architecture support.
# See README.md "Bleeding-edge dependency" for the reproducibility tradeoff
# of pulling `--pre` from the nightly index at build time.
RUN python3 -m pip install --no-cache-dir --pre 'vllm>0.16.0' \
      --extra-index-url https://wheels.vllm.ai/nightly

# vLLM nightly still installs a transformers<5 pin by default; Qwen3.5
# requires transformers>=5. Force the upgrade after vLLM's own install so
# pip's resolver doesn't fight us on the first pass.
RUN python3 -m pip install --no-cache-dir --upgrade 'transformers>=5.0.0'

RUN python3 -m pip install --no-cache-dir 'vllm[video]' hf_transfer

# Cloud Run injects $PORT at runtime — the server must listen on it, not a
# hardcoded port. The model repo id and vLLM flags are the values decided
# in README.md ("Model, quantization and context-length decision").
ENV MODEL_ID="RedHatAI/Qwen3.5-9B-quantized.w4a16" \
    MAX_MODEL_LEN=8192 \
    GPU_MEMORY_UTILIZATION=0.85

# The vLLM-level API key is a second layer of defense behind Cloud Run's
# own IAM-based access control (--no-allow-unauthenticated). It's read
# from an env var populated from Secret Manager at deploy time — see
# DEPLOY.md step (b). Never bake a real key into the image.
ENV QWEN_INFERENCE_API_KEY=""

EXPOSE 8080

# Shell form so $PORT / $MODEL_ID / etc. are expanded at container start,
# not baked in at build time.
CMD python3 -m vllm.entrypoints.openai.api_server \
      --model "$MODEL_ID" \
      --served-model-name qwen3.5-9b \
      --max-model-len "$MAX_MODEL_LEN" \
      --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
      --reasoning-parser qwen3 \
      --default-chat-template-kwargs '{"enable_thinking": false}' \
      --enable-auto-tool-choice \
      --tool-call-parser qwen3_coder \
      --api-key "$QWEN_INFERENCE_API_KEY" \
      --host 0.0.0.0 \
      --port "$PORT"
