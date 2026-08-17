import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildProjectContext } from "./context";
import { loadActiveProjectsWithBrochures } from "./projects";
import { ensureSharedConfig, ensureLeadWorkspace, leadWorkspaceDir, leadStateDir, writeProjectContext } from "./workspace";
import { EFFECTS_FILE_ENV_VAR, readEffects, cleanupEffectsFile } from "./effects";
import { runOpenClawAgent, parseOpenClawReply } from "./openclawProcess";
import type { RunTurnOptions, RunTurnResult } from "./types";

/**
 * Runs one agent turn for a lead: loads context from Prisma, drives one
 * OpenClaw agent turn (spawned as a one-shot embedded CLI process — see
 * lib/agent/README.md for why), persists both sides of the conversation
 * to our own Message table, and reports back what happened.
 *
 * Pure/testable: no WhatsApp-specific code. See scripts/test-agent-turn.ts.
 * For system-triggered (not lead-initiated) messages, see followup.ts.
 *
 * Callers driven by an inbound WhatsApp message must dedupe on
 * `waMessageId` *before* calling this (see app/api/webhooks/whatsapp/route.ts)
 * — Meta retries webhook deliveries on a slow response, and re-running a
 * turn for the same inbound message is exactly the "too many messages"
 * bug (a second, redundant reply sent to the lead) this guards against.
 */
export async function runTurn(
  leadId: string,
  inboundMessageText: string,
  options: RunTurnOptions = {}
): Promise<RunTurnResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!lead) {
    throw new Error(`Lead ${leadId} not found.`);
  }

  // Every active project, not just this lead's own — a single WhatsApp
  // number fields questions about all of them, and a lead's first message
  // is routed to a project somewhat arbitrarily (see the webhook route),
  // so the agent needs every brochure available to answer correctly and
  // to figure out (via switch_project) which one a lead actually means.
  const activeProjects = await loadActiveProjectsWithBrochures();

  const conversation =
    lead.conversation ??
    (await prisma.conversation.create({ data: { leadId }, include: { messages: true } }));
  const isFirstMessage = conversation.messages.length === 0;

  // 1. Persist the inbound message before running the turn. waMessageId is
  // @unique, so a retried delivery that slipped past the webhook route's
  // own pre-check still fails loudly here instead of silently sending a
  // second reply.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      body: inboundMessageText,
      waMessageId: options.waMessageId,
    },
  });

  // 2. Materialize this lead's OpenClaw workspace + the shared config.
  const configPath = await ensureSharedConfig();
  await ensureLeadWorkspace(leadId);
  const projectContext = buildProjectContext({
    leadId,
    isFirstMessage,
    currentProjectId: lead.projectId,
    activeProjects,
    lead: {
      name: lead.name,
      configuration: lead.configuration,
      budget: lead.budget,
      purpose: lead.purpose,
      timeline: lead.timeline,
      stage: lead.stage,
    },
  });
  await writeProjectContext(leadId, projectContext);

  // 3. Drive one OpenClaw agent turn, one session per lead (leadId as the
  // session id — see lib/agent/README.md).
  const effectsFile = path.join(os.tmpdir(), `staffstream-turn-${randomUUID()}.jsonl`);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_WORKSPACE_DIR: leadWorkspaceDir(leadId),
    OPENCLAW_STATE_DIR: leadStateDir(leadId),
    [EFFECTS_FILE_ENV_VAR]: effectsFile,
  };

  let replyText: string;
  try {
    // A non-zero exit code (auth failure, timeout, etc.) rejects here —
    // that's the actual success/failure signal, not a field in the JSON.
    const stdout = await runOpenClawAgent(leadId, inboundMessageText, childEnv);
    replyText = parseOpenClawReply(stdout);
  } catch (err) {
    // Persist a durable record even on failure, then rethrow so the
    // caller (WhatsApp webhook, test script) can decide how to handle it.
    await cleanupEffectsFile(effectsFile);
    throw new Error(`OpenClaw agent turn failed for lead ${leadId}: ${err instanceof Error ? err.message : err}`);
  }

  // 4. Persist the outbound message.
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", body: replyText },
  });

  // 5. Best-effort tool-effect log (see effects.ts) — currently only used
  // to detect request_brochure, since every other tool's effect is
  // already durably reflected in Lead/SiteVisit state.
  const toolEffects = await readEffects(effectsFile);
  await cleanupEffectsFile(effectsFile);

  const brochureEffect = toolEffects.find((e) => e.tool === "request_brochure");
  const brochureResult = brochureEffect?.result as
    | { available?: boolean; gcsPath?: string; fileName?: string }
    | undefined;
  const sendBrochure = Boolean(brochureResult?.available);
  const brochureGcsPath = brochureResult?.gcsPath;
  const brochureFileName = brochureResult?.fileName;

  // 6. Every real exchange counts as contact, regardless of whether a tool
  // happened to touch lastContactedAt itself this turn — this is what the
  // follow-up cron's "no reply in N hours" check is measured against.
  await prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });

  // A lead that's had its first full exchange shouldn't sit in NEW forever.
  // Conditioned on stage still being NEW at this point so it never
  // clobbers a stage a tool already moved further this turn.
  await prisma.lead.updateMany({ where: { id: leadId, stage: "NEW" }, data: { stage: "GREETED" } });

  // Tool handlers (and the update above) write Lead.stage directly — re-read it fresh.
  const freshLead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stage: true } });

  return {
    replyText,
    sendBrochure,
    brochureGcsPath,
    brochureFileName,
    toolEffects,
    leadStage: freshLead.stage,
  };
}
