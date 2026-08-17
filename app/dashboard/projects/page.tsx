import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewProjectForm from "./_components/NewProjectForm";

// Live DB data — see the note in app/dashboard/leads/page.tsx.
export const dynamic = "force-dynamic";

export default async function DashboardProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { documents: true, leads: true } } },
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each project&apos;s brochure is what the WhatsApp assistant answers questions from.
        </p>

        {projects.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">No projects yet — create one below to get started.</p>
        ) : (
          <div className="mt-6 table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Documents</th>
                  <th>Leads</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50">
                    <td>
                      <Link href={`/dashboard/projects/${project.id}`} className="font-medium text-indigo-600 hover:underline">
                        {project.name}
                      </Link>
                    </td>
                    <td>{project.address}</td>
                    <td>
                      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {project.status}
                      </span>
                    </td>
                    <td>{project._count.documents}</td>
                    <td>{project._count.leads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewProjectForm />
    </div>
  );
}
