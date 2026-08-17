import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StageBadge from "./_components/StageBadge";

// Live DB data — must render per-request, not be statically prerendered
// at build time (which would freeze this page's content as of whatever
// was in the DB when `next build` ran, and also break the Docker build
// entirely since no DB is reachable then).
export const dynamic = "force-dynamic";

export default async function DashboardLeadsPage() {
  const leads = await prisma.lead.findMany({
    orderBy: { lastContactedAt: "desc" },
    include: { project: { select: { name: true } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
      <p className="mt-1 text-sm text-slate-500">
        Confirmed site visits and handoffs need you — everything else, the assistant is handling.
      </p>

      {leads.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No leads yet.</p>
      ) : (
        <div className="mt-6 table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name / number</th>
                <th>Project</th>
                <th>Stage</th>
                <th>Last contacted</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-indigo-600 hover:underline">
                      {lead.name ?? lead.whatsappNumber}
                    </Link>
                    {lead.name && <div className="text-xs text-slate-500">{lead.whatsappNumber}</div>}
                  </td>
                  <td>{lead.project.name}</td>
                  <td>
                    <StageBadge stage={lead.stage} />
                  </td>
                  <td>{lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
