import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/gcs";

type RouteContext = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().min(1).max(191) });

/**
 * Permanently deletes a project and everything under it: its documents
 * (DB rows + the actual GCS files), and its leads along with their
 * conversations/messages/site visits. There's no undo — the dashboard
 * requires the builder to type the project's name to confirm before
 * calling this (see DeleteProjectButton.tsx).
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }
  const { id: projectId } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { documents: { select: { gcsPath: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // DB rows first, in a transaction (leaf tables before the ones they
  // reference) — nothing here has an ON DELETE CASCADE, so order matters.
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversation: { lead: { projectId } } } }),
    prisma.conversation.deleteMany({ where: { lead: { projectId } } }),
    prisma.siteVisit.deleteMany({ where: { lead: { projectId } } }),
    prisma.lead.deleteMany({ where: { projectId } }),
    prisma.document.deleteMany({ where: { projectId } }),
    prisma.project.delete({ where: { id: projectId } }),
  ]);

  // GCS cleanup after the DB is already consistent — best-effort, a
  // leftover file in storage is just wasted bytes, not a correctness bug,
  // so one failure shouldn't block deleting the rest.
  const results = await Promise.allSettled(project.documents.map((doc) => deleteFile(doc.gcsPath)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(`[projects] deleted project ${projectId} but failed to remove ${failed} GCS object(s)`);
  }

  return NextResponse.json({ ok: true });
}
