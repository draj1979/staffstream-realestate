import { NextResponse } from "next/server";
import { z } from "zod";
import { getWhatsAppSettingsStatus, updateWhatsAppSettings } from "@/lib/settings";

// GET/POST here are already behind the session cookie (proxy.ts protects
// all of /api/** except the webhook/cron routes) — this is builder-admin
// only, same as everything else under /dashboard.

export async function GET() {
  const status = await getWhatsAppSettingsStatus();
  return NextResponse.json(status);
}

const updateSchema = z.object({
  phoneNumberId: z.string().trim().max(100).optional(),
  accessToken: z.string().trim().max(2000).optional(),
  appSecret: z.string().trim().max(200).optional(),
  verifyToken: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settings." },
      { status: 400 }
    );
  }

  await updateWhatsAppSettings(parsed.data);

  const status = await getWhatsAppSettingsStatus();
  return NextResponse.json(status);
}
