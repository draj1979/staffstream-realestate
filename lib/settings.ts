import { prisma } from "@/lib/prisma";

const SETTINGS_ID = "default";

export interface WhatsAppSettings {
  phoneNumberId: string | null;
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
}

/**
 * Resolves WhatsApp config with DB values (set from /dashboard/settings)
 * taking priority over the WHATSAPP_* env vars/secrets a deploy was
 * configured with — so a fresh deploy keeps working out of the box, and
 * the builder can later switch numbers/tokens without a redeploy.
 */
export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  const row = await prisma.whatsAppSettings.findUnique({ where: { id: SETTINGS_ID } });

  return {
    phoneNumberId: row?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: row?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || null,
    appSecret: row?.appSecret || process.env.WHATSAPP_APP_SECRET || null,
    verifyToken: row?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || null,
  };
}

export interface WhatsAppSettingsInput {
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

/** Only overwrites fields actually provided — an empty/omitted field keeps its current value. */
export async function updateWhatsAppSettings(input: WhatsAppSettingsInput): Promise<void> {
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v));
  if (Object.keys(data).length === 0) return;

  await prisma.whatsAppSettings.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: { id: SETTINGS_ID, ...data },
  });
}

/** For the settings UI: which fields are configured, without ever returning secret values. */
export async function getWhatsAppSettingsStatus(): Promise<{
  phoneNumberId: string | null; // not secret — fine to show as-is
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  source: "database" | "environment";
}> {
  const row = await prisma.whatsAppSettings.findUnique({ where: { id: SETTINGS_ID } });

  return {
    phoneNumberId: row?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    hasAccessToken: Boolean(row?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN),
    hasAppSecret: Boolean(row?.appSecret || process.env.WHATSAPP_APP_SECRET),
    hasVerifyToken: Boolean(row?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN),
    source: row ? "database" : "environment",
  };
}
