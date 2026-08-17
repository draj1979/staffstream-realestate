import { prisma } from "@/lib/prisma";

/**
 * All currently-ACTIVE projects with their latest READY brochure text —
 * this is what gets shown to the agent every turn (see context.ts) so it
 * can answer questions about any project the builder runs, not just the
 * one a given lead happens to be assigned to.
 */
export async function loadActiveProjectsWithBrochures() {
  const projects = await prisma.project.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    projects.map(async (project) => {
      const document = await prisma.document.findFirst({
        where: { projectId: project.id, status: "READY" },
        orderBy: { uploadedAt: "desc" },
      });
      return {
        id: project.id,
        name: project.name,
        address: project.address,
        reraNumber: project.reraNumber,
        brochureText: document?.extractedText ?? null,
      };
    })
  );
}
