import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runTurn } from "@/lib/agent/runTurn";
import { sendTextMessage, sendDocumentMessage } from "@/lib/whatsapp/client";
import { verifyWhatsAppSignature, parseInboundTextMessages } from "@/lib/whatsapp/webhook";
import { checkRateLimit } from "@/lib/rateLimit";
import { getWhatsAppSettings } from "@/lib/settings";

// Blunt a single sender (or a compromised/abusive sender) from hammering
// this endpoint and racking up Claude API calls: 20 messages per 5
// minutes per WhatsApp number. Generous for a real conversation, tight
// enough to stop a spam loop.
const INBOUND_RATE_LIMIT = 20;
const INBOUND_RATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Meta's webhook verification handshake — called once when the webhook
 * URL is configured in the Meta app dashboard, and any time it's
 * re-verified.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const { verifyToken } = await getWhatsAppSettings();

  if (mode === "subscribe" && challenge && verifyToken && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[webhooks/whatsapp] verification handshake rejected", { mode, hasToken: Boolean(token) });
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Inbound message events. WhatsApp Cloud API is the channel; OpenClaw
 * (via lib/agent/runTurn) only does the reasoning/reply-generation — see
 * lib/agent/README.md for why we don't use OpenClaw's own WhatsApp
 * connector (unofficial, single-operator client — not appropriate for a
 * business number serving many unknown external leads).
 */
export async function POST(request: Request) {
  // Signature must be checked against the *raw* body bytes — read text(),
  // not json(), before doing anything else with the request.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const { appSecret } = await getWhatsAppSettings();

  if (!appSecret || !verifyWhatsAppSignature(rawBody, signature, appSecret)) {
    console.warn("[webhooks/whatsapp] rejected: invalid or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but not valid JSON — nothing we can do with it, but the
    // signature already proves it's from Meta, so ack rather than error.
    return NextResponse.json({ ok: true });
  }

  // Meta expects a fast 200 regardless of what happens downstream — errors
  // here are logged, not surfaced as a failed webhook delivery (which
  // would just trigger Meta retries/duplicate processing).
  try {
    await handleInboundMessages(payload);
  } catch (err) {
    console.error("[webhooks/whatsapp] failed to process webhook payload:", err);
  }

  return NextResponse.json({ ok: true });
}

async function handleInboundMessages(payload: unknown): Promise<void> {
  const messages = parseInboundTextMessages(payload);

  // Processed sequentially — MVP traffic volume doesn't need concurrency,
  // and it keeps per-lead OpenClaw session state (Phase 4) from racing.
  for (const message of messages) {
    await handleOneMessage(message);
  }
}

async function handleOneMessage(message: { from: string; messageId: string; text: string; timestamp: string }): Promise<void> {
  console.log("[webhooks/whatsapp] inbound", {
    messageId: message.messageId,
    from: redactPhoneNumber(message.from),
    timestamp: message.timestamp,
  });

  const rateLimit = checkRateLimit(`whatsapp-inbound:${message.from}`, INBOUND_RATE_LIMIT, INBOUND_RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    console.warn("[webhooks/whatsapp] rate limit exceeded — dropping message", {
      from: redactPhoneNumber(message.from),
      messageId: message.messageId,
    });
    return;
  }

  const project = await getDefaultActiveProject();
  if (!project) {
    console.error("[webhooks/whatsapp] no active project configured — dropping inbound message", {
      messageId: message.messageId,
    });
    return;
  }

  const whatsappNumber = `+${message.from}`;
  const lead = await prisma.lead.upsert({
    where: { projectId_whatsappNumber: { projectId: project.id, whatsappNumber } },
    update: {},
    create: { projectId: project.id, whatsappNumber },
  });

  console.log("[webhooks/whatsapp] resolved lead", { leadId: lead.id, messageId: message.messageId });

  // Meta retries webhook deliveries when our response is slow (agent turns
  // can take a while), which would otherwise re-run the turn and send the
  // lead a second, redundant reply. Dedupe on WhatsApp's own message id
  // before doing any of that work.
  const alreadyProcessed = await prisma.message.findUnique({ where: { waMessageId: message.messageId } });
  if (alreadyProcessed) {
    console.log("[webhooks/whatsapp] duplicate delivery — already processed, skipping", {
      leadId: lead.id,
      messageId: message.messageId,
    });
    return;
  }

  // runTurn.ts finds-or-creates this lead's Conversation and persists both
  // sides of the exchange as Message rows itself (see lib/agent/runTurn.ts) —
  // no need to duplicate that here.
  const result = await runTurn(lead.id, message.text, { waMessageId: message.messageId });

  const sent = await sendTextMessage(message.from, result.replyText);
  console.log("[webhooks/whatsapp] outbound reply sent", {
    leadId: lead.id,
    messageId: sent.messageId,
    timestamp: new Date().toISOString(),
  });

  if (result.sendBrochure && result.brochureGcsPath) {
    const doc = await sendDocumentMessage(message.from, {
      gcsPath: result.brochureGcsPath,
      filename: result.brochureFileName ?? "Brochure.pdf",
    });
    console.log("[webhooks/whatsapp] outbound brochure sent", {
      leadId: lead.id,
      messageId: doc.messageId,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * MVP simplification: this builder runs one WhatsApp Business number for
 * one active project at a time, so every inbound message is routed to
 * whichever Project is currently ACTIVE (oldest first, for stability as
 * more are added). If the builder ever runs multiple active
 * projects/numbers concurrently, this needs to become a real mapping from
 * WHATSAPP_PHONE_NUMBER_ID (or the destination number in the webhook
 * payload) to a specific Project.
 */
async function getDefaultActiveProject() {
  return prisma.project.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/** Keeps phone numbers out of info-level logs; last 4 digits only. */
function redactPhoneNumber(phoneNumber: string): string {
  return `***${phoneNumber.slice(-4)}`;
}
