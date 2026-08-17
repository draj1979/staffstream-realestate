import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import DocumentsPanel from "./_components/DocumentsPanel";
import DeleteProjectButton from "./_components/DeleteProjectButton";

// Live DB data — see the note in app/dashboard/leads/page.tsx.
export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      documents: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true,
          fileName: true,
          status: true,
          processingError: true,
          uploadedAt: true,
        },
      },
      _count: { select: { leads: true } },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/dashboard/projects" className="text-sm text-slate-500 hover:text-slate-700">
          ← Projects
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{project.address}</p>
          </div>
          <span className="inline-block shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            {project.status}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-500">RERA number: {project.reraNumber ?? "—"}</p>
      </div>

      <DocumentsPanel
        projectId={project.id}
        initialDocuments={project.documents.map((doc) => ({
          ...doc,
          uploadedAt: doc.uploadedAt.toISOString(),
        }))}
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Danger zone</h2>
        <DeleteProjectButton
          projectId={project.id}
          projectName={project.name}
          leadCount={project._count.leads}
          documentCount={project.documents.length}
        />
      </div>
    </div>
  );
}
