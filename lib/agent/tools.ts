import type { PrismaClient } from "@/app/generated/prisma/client";
import { recordEffect } from "./effects";
import { notifyBuilder } from "@/lib/notify";

/**
 * The five tools the sales agent can call. Each is a plain, testable
 * async function — `mcp-server.ts` wraps these with MCP tool schemas, and
 * tests can call them directly with no MCP/OpenClaw involved.
 *
 * All five take `leadId` and scope every read/write to it.
 */

export interface UpdateLeadInfoArgs {
  leadId: string;
  configuration?: string;
  budget?: string;
  purpose?: string;
  timeline?: string;
  name?: string;
}

// Stages the lead is still being actively nurtured in — i.e. not yet
// scheduled, handed off, or lost. Stage promotion below never touches a
// lead outside this set.
const ACTIVE_NURTURE_STAGES = new Set(["NEW", "GREETED", "QUALIFYING", "QUALIFIED", "FOLLOWUP"]);

export async function updateLeadInfo(prisma: PrismaClient, args: UpdateLeadInfoArgs) {
  const { leadId, ...fields } = args;
  const data = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")
  );

  const updated = Object.keys(data);
  let lead =
    updated.length > 0
      ? await prisma.lead.update({ where: { id: leadId }, data: { ...data, lastContactedAt: new Date() } })
      : await prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });

  // Nothing else in the system moves a lead through the qualification
  // pipeline, so do it here: any requirement field being captured means
  // the lead is at least "qualifying"; once all four core fields are
  // known, they're "qualified". This is what makes the follow-up cron's
  // stage-based eligibility filter (app/api/cron/followups) meaningful —
  // without it, leads would sit in NEW forever regardless of how much the
  // agent has actually learned about them.
  if (updated.length > 0 && ACTIVE_NURTURE_STAGES.has(lead.stage)) {
    const allCoreFieldsKnown = Boolean(lead.configuration && lead.budget && lead.purpose && lead.timeline);
    const nextStage = allCoreFieldsKnown ? "QUALIFIED" : "QUALIFYING";
    if (nextStage !== lead.stage) {
      lead = await prisma.lead.update({ where: { id: leadId }, data: { stage: nextStage } });
    }
  }

  const result = {
    updatedFields: updated,
    lead: {
      configuration: lead.configuration,
      budget: lead.budget,
      purpose: lead.purpose,
      timeline: lead.timeline,
      name: lead.name,
    },
  };
  await recordEffect("update_lead_info", args, result);
  return result;
}

export interface ProposeSiteVisitArgs {
  leadId: string;
  slots: string[];
}

export async function proposeSiteVisit(prisma: PrismaClient, args: ProposeSiteVisitArgs) {
  const { leadId, slots } = args;

  const existing = await prisma.siteVisit.findFirst({
    where: { leadId, status: "PROPOSED" },
    orderBy: { createdAt: "desc" },
  });

  const siteVisit = existing
    ? await prisma.siteVisit.update({
        where: { id: existing.id },
        data: { proposedSlots: slots },
      })
    : await prisma.siteVisit.create({
        data: { leadId, proposedSlots: slots, status: "PROPOSED" },
      });

  await prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });

  const result = { siteVisitId: siteVisit.id, slots };
  await recordEffect("propose_site_visit", args, result);
  return result;
}

export interface ConfirmSiteVisitArgs {
  leadId: string;
  slot: string;
}

export async function confirmSiteVisit(prisma: PrismaClient, args: ConfirmSiteVisitArgs) {
  const { leadId, slot } = args;

  const confirmedSlot = new Date(slot);
  if (Number.isNaN(confirmedSlot.getTime())) {
    throw new Error(
      `"${slot}" isn't a valid date-time. Use an ISO 8601 date-time (e.g. 2026-08-20T10:00:00+05:30).`
    );
  }

  const existing = await prisma.siteVisit.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
  });

  const siteVisit = existing
    ? await prisma.siteVisit.update({
        where: { id: existing.id },
        data: { confirmedSlot, status: "CONFIRMED" },
      })
    : await prisma.siteVisit.create({
        data: { leadId, confirmedSlot, status: "CONFIRMED" },
      });

  await prisma.lead.update({
    where: { id: leadId },
    data: { stage: "SITE_VISIT_SCHEDULED", lastContactedAt: new Date() },
  });

  const result = { siteVisitId: siteVisit.id, confirmedSlot: confirmedSlot.toISOString() };
  await recordEffect("confirm_site_visit", args, result);
  notifyBuilder("Site visit confirmed", { leadId, confirmedSlot: result.confirmedSlot });
  return result;
}

export interface RequestBrochureArgs {
  leadId: string;
  /**
   * Which project's brochure to send, by name (case-insensitive,
   * substring match) — required whenever more than one active project
   * exists, since a lead's default project (see switch_project) may not
   * be the one they're actually asking about right now. Optional when
   * there's only one active project.
   */
  projectName?: string;
}

export async function requestBrochure(prisma: PrismaClient, args: RequestBrochureArgs) {
  const { leadId, projectName } = args;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { projectId: true } });
  if (!lead) {
    throw new Error(`Lead ${leadId} not found.`);
  }

  let projectId = lead.projectId;
  if (projectName) {
    const matched = await findActiveProjectByName(prisma, projectName);
    if (!matched) {
      const result = { available: false as const, error: `No active project matching "${projectName}".` };
      await recordEffect("request_brochure", args, result);
      return result;
    }
    projectId = matched.id;
  }

  const document = await prisma.document.findFirst({
    where: { projectId, status: "READY" },
    orderBy: { uploadedAt: "desc" },
  });

  if (!document) {
    const result = { available: false as const };
    await recordEffect("request_brochure", args, result);
    return result;
  }

  const result = { available: true as const, gcsPath: document.gcsPath, fileName: document.fileName };
  await recordEffect("request_brochure", args, result);
  return result;
}

export interface SwitchProjectArgs {
  leadId: string;
  /** Name (case-insensitive, substring match) of the project this lead is actually asking about. */
  projectName: string;
}

/**
 * Corrects which project a lead is on record as asking about — needed
 * because a lead's first message is routed to a project somewhat
 * arbitrarily (see app/api/webhooks/whatsapp/route.ts), and a builder
 * running several active projects means that guess is often wrong. Keeps
 * the dashboard's "Project" column (and any project-scoped tool default)
 * accurate once it's actually clear from conversation.
 */
export async function switchProject(prisma: PrismaClient, args: SwitchProjectArgs) {
  const { leadId, projectName } = args;

  const matched = await findActiveProjectByName(prisma, projectName);
  if (!matched) {
    const result = { switched: false as const, error: `No active project matching "${projectName}".` };
    await recordEffect("switch_project", args, result);
    return result;
  }

  await prisma.lead.update({ where: { id: leadId }, data: { projectId: matched.id, lastContactedAt: new Date() } });

  const result = { switched: true as const, projectId: matched.id, projectName: matched.name };
  await recordEffect("switch_project", args, result);
  return result;
}

async function findActiveProjectByName(prisma: PrismaClient, name: string) {
  return prisma.project.findFirst({
    where: { status: "ACTIVE", name: { contains: name, mode: "insensitive" } },
  });
}

export interface HandoffToHumanArgs {
  leadId: string;
  reason: string;
}

export async function handoffToHuman(prisma: PrismaClient, args: HandoffToHumanArgs) {
  const { leadId, reason } = args;

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: { stage: "HANDED_OFF", handoffReason: reason, lastContactedAt: new Date() },
  });

  const result = { stage: lead.stage, reason };
  await recordEffect("handoff_to_human", args, result);
  notifyBuilder("Lead handed off to a human", { leadId, reason });
  return result;
}
