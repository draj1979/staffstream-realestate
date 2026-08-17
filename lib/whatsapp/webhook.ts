import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body.
 * This is the main anti-spoofing control on the webhook — callers must
 * pass the *raw* (unparsed) body text, since the signature is computed
 * over the exact bytes Meta sent, not a re-serialized JSON object.
 */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    return false; // timingSafeEqual throws on length mismatch
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export interface InboundTextMessage {
  from: string;
  messageId: string;
  text: string;
  timestamp: string;
}

// WhatsApp's own text message limit — also bounds what ends up in our DB
// and gets fed to the Claude agent per inbound message.
const MAX_MESSAGE_TEXT_LENGTH = 4096;

// Structural validation for the fields we actually read — the real
// payload has more (statuses, other message types, contacts, etc.), which
// simply falls outside this shape and gets ignored below rather than
// rejected outright (Meta's payload shape has grown over time; being
// permissive about extra/unknown fields, but strict about the types of
// the fields we do use, is the right tradeoff here).
const webhookPayloadSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string().optional(),
              value: z
                .object({
                  messages: z
                    .array(
                      z.object({
                        id: z.string(),
                        from: z.string(),
                        timestamp: z.string(),
                        type: z.string(),
                        text: z.object({ body: z.string().max(MAX_MESSAGE_TEXT_LENGTH) }).optional(),
                      })
                    )
                    .optional(),
                })
                .optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

/**
 * Pulls out inbound text messages from a webhook payload. Other event
 * types (delivery/read statuses, non-text messages) are intentionally
 * ignored for this MVP. A payload that doesn't match the expected shape
 * at all is logged and treated as empty, rather than throwing — the
 * signature already proved it's genuinely from Meta, so a shape we don't
 * recognize isn't an attack, just something to no-op on.
 */
export function parseInboundTextMessages(payload: unknown): InboundTextMessage[] {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn("[whatsapp/webhook] payload did not match the expected shape — skipping");
    return [];
  }

  const messages: InboundTextMessage[] = [];

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const message of change.value?.messages ?? []) {
        if (message.type === "text" && message.text?.body) {
          messages.push({
            from: message.from,
            messageId: message.id,
            text: message.text.body,
            timestamp: message.timestamp,
          });
        }
      }
    }
  }

  return messages;
}
