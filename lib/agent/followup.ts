import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildProjectContext } from "./context";
import { loadActiveProjectsWithBrochures } from "./projects";
import { ensureSharedConfig, ensureLeadWorkspace, leadWorkspaceDir, leadStateDir, writeProjectContext } from "./workspace";
import { EFFECTS_FILE_ENV_VAR, readEffects, cleanupEffectsFile } from "./effects";
import { runOpenClawAgent, parseOpenClawReply } from "./openclawProcess";
import type { RunTurnResult } from "./types";

// A clearly-tagged internal cue — the Project Context this turn's
// followupMode flag adds (see context.ts) tells the model this isn't
// something the lead said, and to write only the re-engagement message
// itself in response.
const FOLLOWUP_TRIGGER_MESSAGE = "[SYSTEM TRIGGER: FOLLOW_UP] Generate the re-engagement message now.";

/**
 * Generates one automated re-engagement message for a lead who's gone
 * quiet — reuses the same persona, workspace, and OpenClaw session as
 * runTurn.ts (so the model has full conversation history), but with a
 * system-triggered cue instead of a real inbound message, and persists
 * only the outbound side (the trigger itself isn't something the lead
 * said, so it doesn't belong in our Message history).
 *
 * Called by app/api/cron/followups — sending the result via WhatsApp and
 * updating Lead.stage/lastContactedAt/followupCount is the caller's job.
 */
export async function generateFollowupMessage(leadId: string): Promise<RunTurnResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { conversation: true },
  });
  if (!lead) {
    throw new Error(`Lead ${leadId} not found.`);
  }
  const conversation =
    lead.conversation ?? (await prisma.conversation.create({ data: { leadId } }));

  // See the equivalent note in runTurn.ts — all active projects, not just this lead's own.
  const activeProjects = await loadActiveProjectsWithBrochures();

  const configPath = await ensureSharedConfig();
  await ensureLeadWorkspace(leadId);
  const projectContext = buildProjectContext({
    leadId,
    isFirstMessage: false,
    followupMode: true,
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

  const effectsFile = path.join(os.tmpdir(), `staffstream-followup-${randomUUID()}.jsonl`);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_WORKSPACE_DIR: leadWorkspaceDir(leadId),
    OPENCLAW_STATE_DIR: leadStateDir(leadId),
    [EFFECTS_FILE_ENV_VAR]: effectsFile,
  };

  let replyText: string;
  try {
    const stdout = await runOpenClawAgent(leadId, FOLLOWUP_TRIGGER_MESSAGE, childEnv);
    replyText = parseOpenClawReply(stdout);
  } catch (err) {
    await cleanupEffectsFile(effectsFile);
    throw new Error(`OpenClaw follow-up generation failed for lead ${leadId}: ${err instanceof Error ? err.message : err}`);
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", body: replyText },
  });

  const toolEffects = await readEffects(effectsFile);
  await cleanupEffectsFile(effectsFile);

  const brochureEffect = toolEffects.find((e) => e.tool === "request_brochure");
  const brochureResult = brochureEffect?.result as
    | { available?: boolean; gcsPath?: string; fileName?: string }
    | undefined;

  const freshLead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stage: true } });

  return {
    replyText,
    sendBrochure: Boolean(brochureResult?.available),
    brochureGcsPath: brochureResult?.gcsPath,
    brochureFileName: brochureResult?.fileName,
    toolEffects,
    leadStage: freshLead.stage,
  };
}
