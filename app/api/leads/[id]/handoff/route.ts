import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyBuilder } from "@/lib/notify";

type RouteContext = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().min(1).max(191) });

/** Lets the builder manually override and hand a lead off, regardless of what the AI was doing. */
export async function POST(_request: Request, { params }: RouteContext) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });
  }
  const { id: leadId } = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { stage: "HANDED_OFF", handoffReason: "Manually marked by builder from the dashboard" },
  });

  notifyBuilder("Lead manually handed off", { leadId });

  return NextResponse.json({ lead: updated });
}
