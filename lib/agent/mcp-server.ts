#!/usr/bin/env -S npx tsx
/**
 * Standalone MCP (Model Context Protocol) stdio server exposing this
 * agent's five tools. OpenClaw spawns this as a subprocess per the
 * `mcp.servers` entry in the generated openclaw.json (see workspace.ts) —
 * see lib/agent/README.md for why MCP is the tool-registration mechanism
 * we picked.
 *
 * This runs in its own process (a grandchild of the Next.js server), so it
 * has its own Prisma client/connection — see lib/agent/README.md.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";
import {
  updateLeadInfo,
  proposeSiteVisit,
  confirmSiteVisit,
  requestBrochure,
  handoffToHuman,
  switchProject,
} from "./tools";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const server = new McpServer({ name: "staffstream-agent-tools", version: "1.0.0" });

const leadId = z.string().min(1).describe("The internal leadId given to you in Project Context. Always pass it verbatim.");

function asToolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function asToolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.registerTool(
  "update_lead_info",
  {
    title: "Update lead info",
    description:
      "Record or update any of this lead's requirement fields as soon as you learn them: configuration, budget, purpose, timeline, name. Only pass the fields you actually learned this turn.",
    inputSchema: {
      leadId,
      configuration: z.string().optional().describe("e.g. '3BHK'"),
      budget: z.string().optional().describe("e.g. '80-90 lakhs'"),
      purpose: z.string().optional().describe("'self-use' or 'investment'"),
      timeline: z.string().optional().describe("e.g. 'within 3 months'"),
      name: z.string().optional(),
    },
  },
  async (args) => {
    try {
      return asToolResult(await updateLeadInfo(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

server.registerTool(
  "propose_site_visit",
  {
    title: "Propose site visit slots",
    description:
      "Propose 2-3 concrete site visit slots to the lead once they seem ready. Slots should be ISO 8601 date-times.",
    inputSchema: {
      leadId,
      slots: z.array(z.string()).min(1).describe("ISO 8601 date-time strings, e.g. '2026-08-20T10:00:00+05:30'"),
    },
  },
  async (args) => {
    try {
      return asToolResult(await proposeSiteVisit(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

server.registerTool(
  "confirm_site_visit",
  {
    title: "Confirm site visit",
    description:
      "Confirm the site visit slot the lead picked. Call this once they've committed to a specific time, then call handoff_to_human with reason 'Site visit confirmed'.",
    inputSchema: {
      leadId,
      slot: z.string().describe("The ISO 8601 date-time the lead confirmed"),
    },
  },
  async (args) => {
    try {
      return asToolResult(await confirmSiteVisit(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

server.registerTool(
  "request_brochure",
  {
    title: "Request brochure send",
    description:
      "Signal that the brochure PDF should be sent to the lead as a WhatsApp document. The surrounding system sends the actual file — you just tell the lead you're sending it.",
    inputSchema: {
      leadId,
      projectName: z
        .string()
        .optional()
        .describe(
          "Which project's brochure to send, by name. Required if we're running more than one active project — always pass the name of the project the lead is actually asking about, which may differ from their default."
        ),
    },
  },
  async (args) => {
    try {
      return asToolResult(await requestBrochure(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

server.registerTool(
  "switch_project",
  {
    title: "Switch which project this lead is asking about",
    description:
      "Corrects which project this lead is on record for, when it's clear from the conversation they mean a different one than they were first assigned to (this happens routinely — a lead's first message is auto-assigned to a project somewhat arbitrarily). Call this as soon as you're confident which project they actually mean, so our records stay accurate — it doesn't end the conversation, just relabels it.",
    inputSchema: {
      leadId,
      projectName: z.string().min(1).describe("Name (or a distinctive part of it) of the project this lead is actually asking about"),
    },
  },
  async (args) => {
    try {
      return asToolResult(await switchProject(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

server.registerTool(
  "handoff_to_human",
  {
    title: "Hand off to a human",
    description:
      "Stop handling this conversation yourself and flag it for a human. Use this when a site visit is confirmed, the lead asks for a person, the question is outside the brochure's scope, or it becomes a real negotiation/complaint.",
    inputSchema: {
      leadId,
      reason: z.string().min(1).describe("Short, specific reason, e.g. 'Site visit confirmed' or 'Asked for a discount beyond brochure pricing'"),
    },
  },
  async (args) => {
    try {
      return asToolResult(await handoffToHuman(prisma, args));
    } catch (err) {
      return asToolError(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[agent/mcp-server] fatal:", err);
  process.exit(1);
});
