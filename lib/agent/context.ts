interface ProjectInfo {
  id: string;
  name: string;
  address: string;
  reraNumber: string | null;
  brochureText: string | null;
}

interface ProjectContextInput {
  leadId: string;
  isFirstMessage: boolean;
  /** The project this lead is currently associated with (shown in the dashboard, used by tools by default). */
  currentProjectId: string;
  /** Every currently-ACTIVE project the builder runs — not just the lead's own. */
  activeProjects: ProjectInfo[];
  lead: {
    name: string | null;
    configuration: string | null;
    budget: string | null;
    purpose: string | null;
    timeline: string | null;
    stage: string;
  };
  /**
   * True when this turn is the automated follow-up cron generating a
   * re-engagement nudge (see followup.ts), not a reply to something the
   * lead actually said.
   */
  followupMode?: boolean;
}

/**
 * Builds the per-turn "Project Context" markdown that gets written to
 * PROJECT_CONTEXT.md in this lead's OpenClaw workspace before every turn
 * (see workspace.ts) — the brochure text and captured lead fields change
 * per conversation, so they're injected fresh each turn rather than baked
 * into the static persona files (AGENTS.md/SOUL.md/IDENTITY.md).
 *
 * Includes ALL of the builder's active projects, not just the one the
 * lead happens to be assigned to — a single WhatsApp number fields
 * questions about every project the builder is running, and a lead's
 * first message is routed to a project somewhat arbitrarily (see
 * app/api/webhooks/whatsapp/route.ts). Without every project's brochure
 * here, the agent has no way to answer a lead asking about a project it
 * wasn't initially assigned to.
 */
export function buildProjectContext(input: ProjectContextInput): string {
  const { leadId, isFirstMessage, currentProjectId, activeProjects, lead, followupMode = false } = input;

  const capturedFields = [
    ["Name", lead.name],
    ["Configuration", lead.configuration],
    ["Budget", lead.budget],
    ["Purpose", lead.purpose],
    ["Timeline", lead.timeline],
  ].filter(([, v]) => Boolean(v));

  const lines: string[] = [
    "# Project Context",
    "",
    "This section is regenerated fresh every turn. Trust it over anything",
    "you think you remember from earlier turns.",
    "",
    `- Internal leadId (pass verbatim to every tool call): \`${leadId}\``,
    `- First message from this lead: ${isFirstMessage ? "yes — greet them" : "no — continue the conversation naturally"}`,
    `- Lead's current stage: ${lead.stage}`,
    `- This lead is currently on record as asking about: \`${currentProjectId}\` (see below) — this is a` +
      " starting guess, not necessarily correct; identify the right project from what the lead actually says.",
  ];

  if (followupMode) {
    lines.push(
      "",
      "## This turn is an automated re-engagement trigger, not a message from the lead",
      "",
      "The incoming message below is a system-generated cue, not something the lead",
      "said. Write ONE short, natural re-engagement message referencing what you",
      "already know about them (see requirement fields below) to nudge them back into",
      "the conversation. Ask at most one question. Do not acknowledge or reference",
      "the trigger itself — write only the message that should go to the lead."
    );
  }

  lines.push(
    "",
    "## Requirement fields captured so far",
    ""
  );

  if (capturedFields.length === 0) {
    lines.push("(none yet)");
  } else {
    for (const [label, value] of capturedFields) {
      lines.push(`- ${label}: ${value}`);
    }
  }

  lines.push(
    "",
    "## Active projects",
    "",
    activeProjects.length > 1
      ? "We're currently running more than one project. Figure out which one this lead means from" +
          " what they say (they may name it, or it may be obvious from earlier turns) — don't assume" +
          " it's whichever one is marked \"currently on record\" above. Once you're confident which" +
          " project a lead is actually interested in, call `switch_project` if it differs from the" +
          " one on record, so our CRM reflects it correctly. If a lead's interest genuinely isn't" +
          " clear yet, ask which project they mean rather than guessing."
      : "There's currently one active project.",
    ""
  );

  for (const project of activeProjects) {
    const isCurrent = project.id === currentProjectId;
    lines.push(
      `### ${project.name}${isCurrent ? " (currently on record for this lead)" : ""}`,
      "",
      `- Internal projectId: \`${project.id}\``,
      `- Address: ${project.address}`,
      `- RERA number: ${project.reraNumber ?? "not provided in our records"}`,
      "",
      "Brochure text (this is your only source of truth for this project's facts):",
      "",
      project.brochureText ??
        "(No ready brochure is available for this project yet. Don't invent details — tell the lead" +
          " you'll confirm specifics shortly, and offer to have someone follow up.)",
      ""
    );
  }

  return lines.join("\n");
}
