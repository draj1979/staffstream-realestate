/**
 * Sanity-check script for lib/agent/runTurn.ts — seeds a throwaway
 * project + READY document + lead, runs two turns against the same lead,
 * and prints what happened so we can eyeball the conversation logic
 * before wiring up WhatsApp.
 *
 * Usage: npm run test:agent
 *
 * Requires ANTHROPIC_API_KEY (real Claude calls happen here) and a
 * reachable DATABASE_URL — both read from .env.local.
 */
import { prisma } from "../lib/prisma";
import { runTurn } from "../lib/agent/runTurn";

const BROCHURE_TEXT = `
Test Agent Towers - Premium 2BHK and 3BHK Apartments

Located at 42 Test Lane, Bengaluru. RERA Registered (PRM/KA/RERA/TEST/000001).

2BHK units: 1050 sq ft, starting at Rs 78 Lakhs.
3BHK units: 1450 sq ft, starting at Rs 1.15 Crore.

Amenities: swimming pool, clubhouse, landscaped gardens, 24x7 security, covered parking.

Possession expected March 2028.
`.trim();

async function main() {
  const project = await prisma.project.create({
    data: {
      name: "Test Agent Towers",
      address: "42 Test Lane, Bengaluru",
      reraNumber: "PRM/KA/RERA/TEST/000001",
    },
  });

  const document = await prisma.document.create({
    data: {
      projectId: project.id,
      fileName: "test-brochure.pdf",
      gcsPath: `documents/${project.id}/test-brochure.pdf`,
      extractedText: BROCHURE_TEXT,
      status: "READY",
    },
  });

  const lead = await prisma.lead.create({
    data: { projectId: project.id, whatsappNumber: "+911234500000" },
  });

  console.log(`Seeded project=${project.id} document=${document.id} lead=${lead.id}\n`);

  try {
    console.log("=== Turn 1 ===");
    console.log("Inbound: Hi, I'm looking for a 3 BHK");
    const turn1 = await runTurn(lead.id, "Hi, I'm looking for a 3 BHK");
    console.log("Reply:", turn1.replyText);
    console.log("Lead stage:", turn1.leadStage);
    console.log("Tool effects:", JSON.stringify(turn1.toolEffects, null, 2));

    const leadAfterTurn1 = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    console.log("Lead.configuration after turn 1:", leadAfterTurn1.configuration);

    console.log("\n=== Turn 2 (same lead — session should remember turn 1) ===");
    console.log("Inbound: What's the price range?");
    const turn2 = await runTurn(lead.id, "What's the price range?");
    console.log("Reply:", turn2.replyText);
    console.log("Lead stage:", turn2.leadStage);

    console.log(
      "\nSanity check: turn 2's reply should NOT re-ask what configuration you're\n" +
        "looking for — turn 1 already established 3BHK via update_lead_info, and the\n" +
        "OpenClaw session (keyed by leadId) should remember it."
    );
  } finally {
    console.log("\nCleaning up test data...");
    await prisma.message.deleteMany({ where: { conversation: { leadId: lead.id } } });
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
    await prisma.siteVisit.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.document.delete({ where: { id: document.id } });
    await prisma.project.delete({ where: { id: project.id } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
