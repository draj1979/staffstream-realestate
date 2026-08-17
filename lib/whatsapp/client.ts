import { downloadFile } from "@/lib/gcs";
import { getWhatsAppSettings } from "@/lib/settings";

// Meta's Graph API version — bump this when Meta deprecates the current one.
const GRAPH_API_VERSION = "v22.0";

async function requireSetting(field: "phoneNumberId" | "accessToken"): Promise<string> {
  const settings = await getWhatsAppSettings();
  const value = settings[field];
  if (!value) {
    throw new Error(
      `WhatsApp ${field} is not configured — set it in /dashboard/settings or the WHATSAPP_* env vars.`
    );
  }
  return value;
}

async function graphPost<T>(path: string, body: BodyInit, extraHeaders?: Record<string, string>): Promise<T> {
  const phoneNumberId = await requireSetting("phoneNumberId");
  const accessToken = await requireSetting("accessToken");
  const apiBase = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}`;

  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
    body,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp API request to ${path} failed: ${res.status} ${errorBody}`);
  }

  return res.json() as Promise<T>;
}

interface SendMessageResponse {
  messages?: { id: string }[];
}

/**
 * Sends a plain text WhatsApp message. `to` is the recipient's number in
 * the format WhatsApp gave us in the inbound webhook (no leading "+").
 */
export async function sendTextMessage(to: string, body: string): Promise<{ messageId: string }> {
  const result = await graphPost<SendMessageResponse>(
    "/messages",
    JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
    { "Content-Type": "application/json" }
  );

  const messageId = result.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp API did not return a message id for the text message.");
  }
  return { messageId };
}

/**
 * Sends a PDF stored in GCS as a WhatsApp document message: downloads the
 * bytes, uploads them to WhatsApp's media endpoint, then references that
 * media id in a document message.
 */
export async function sendDocumentMessage(
  to: string,
  document: { gcsPath: string; filename: string }
): Promise<{ messageId: string }> {
  const buffer = await downloadFile(document.gcsPath);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), document.filename);

  const mediaResult = await graphPost<{ id?: string }>("/media", form);
  if (!mediaResult.id) {
    throw new Error("WhatsApp API did not return a media id for the uploaded document.");
  }

  const result = await graphPost<SendMessageResponse>(
    "/messages",
    JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mediaResult.id, filename: document.filename },
    }),
    { "Content-Type": "application/json" }
  );

  const messageId = result.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp API did not return a message id for the document message.");
  }
  return { messageId };
}
