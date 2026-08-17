import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateFollowupMessage } from "@/lib/agent/followup";
import { sendTextMessage, sendDocumentMessage } from "@/lib/whatsapp/client";

// Total automated follow-ups a lead can receive before we give up and
// mark them LOST. Product rule: follow up at most twice after the initial
// enquiry, spaced a day apart (see FOLLOWUP_THRESHOLD_HOURS, default 24h).
const FOLLOWUP_CAP = 2;

// Stages a lead can still be nudged in. NEW is excluded on purpose — the
// agent hasn't greeted them yet, so there's nothing to "follow up" on.
// SITE_VISIT_SCHEDULED/HANDED_OFF/LOST are excluded because the AI's job
// is already done (or was taken over) for those leads.
const ELIGIBLE_STAGES = ["GREETED", "QUALIFYING", "QUALIFIED", "FOLLOWUP"] as const;

function followupThresholdHours(): number {
  const raw = process.env.FOLLOWUP_THRESHOLD_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided) return false;

  const secretBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (secretBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(secretBuf, providedBuf);
}

/**
 * Called by Cloud Scheduler (or `curl` locally with the header set) — not
 * a browser, so this is protected by a shared secret header, not the
 * session cookie (see proxy.ts's /api/cron/** exclusion).
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    console.warn("[cron/followups] rejected: invalid or missing X-Cron-Secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const thresholdHours = followupThresholdHours();
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      stage: { in: [...ELIGIBLE_STAGES] },
      lastContactedAt: { lt: cutoff },
    },
  });

  console.log(`[cron/followups] ${leads.length} lead(s) due (threshold=${thresholdHours}h)`);

  let sent = 0;
  let markedLost = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      if (lead.followupCount >= FOLLOWUP_CAP) {
        await prisma.lead.update({ where: { id: lead.id }, data: { stage: "LOST" } });
        markedLost++;
        console.log(`[cron/followups] lead ${lead.id} hit the follow-up cap (${FOLLOWUP_CAP}) — marked LOST`);
        continue;
      }

      const result = await generateFollowupMessage(lead.id);

      const to = lead.whatsappNumber.replace(/^\+/, "");
      const sentMessage = await sendTextMessage(to, result.replyText);

      if (result.sendBrochure && result.brochureGcsPath) {
        await sendDocumentMessage(to, {
          gcsPath: result.brochureGcsPath,
          filename: result.brochureFileName ?? "Brochure.pdf",
        });
      }

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          lastContactedAt: new Date(),
          stage: "FOLLOWUP",
          followupCount: { increment: 1 },
        },
      });

      sent++;
      console.log("[cron/followups] sent follow-up", {
        leadId: lead.id,
        messageId: sentMessage.messageId,
        followupCount: lead.followupCount + 1,
      });
    } catch (err) {
      failed++;
      console.error(`[cron/followups] failed to process lead ${lead.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, checked: leads.length, sent, markedLost, failed });
}
