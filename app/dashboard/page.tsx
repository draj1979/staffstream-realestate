import Link from "next/link";
import { prisma } from "@/lib/prisma";

// Live DB data — see the note in app/dashboard/leads/page.tsx.
export const dynamic = "force-dynamic";

export default async function DashboardOverviewPage() {
  const [projectCount, leadCount, needsAttentionCount, readyDocumentCount] = await Promise.all([
    prisma.project.count({ where: { status: "ACTIVE" } }),
    prisma.lead.count(),
    prisma.lead.count({ where: { stage: { in: ["SITE_VISIT_SCHEDULED", "HANDED_OFF"] } } }),
    prisma.document.count({ where: { status: "READY" } }),
  ]);

  const stats = [
    { label: "Active projects", value: projectCount, href: "/dashboard/projects" },
    { label: "Total leads", value: leadCount, href: "/dashboard/leads" },
    { label: "Need your attention", value: needsAttentionCount, href: "/dashboard/leads", highlight: needsAttentionCount > 0 },
    { label: "Brochures ready", value: readyDocumentCount, href: "/dashboard/projects" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
      <p className="mt-1 text-sm text-slate-500">
        A quick look at your projects and leads. Handoffs and confirmed site visits need you.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className={`card transition-shadow hover:shadow-md ${stat.highlight ? "border-amber-300 bg-amber-50" : ""}`}
          >
            <p className={`text-2xl font-semibold ${stat.highlight ? "text-amber-700" : "text-slate-900"}`}>
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 card">
        <h2 className="text-sm font-semibold text-slate-900">Getting started</h2>
        <ol className="mt-3 flex flex-col gap-2 text-sm text-slate-600">
          <li>
            1. Create a project and upload its brochure PDF in{" "}
            <Link href="/dashboard/projects" className="font-medium text-indigo-600 hover:underline">
              Projects
            </Link>
            .
          </li>
          <li>
            2. Connect your WhatsApp Business number in{" "}
            <Link href="/dashboard/settings" className="font-medium text-indigo-600 hover:underline">
              Settings
            </Link>
            .
          </li>
          <li>
            3. Watch conversations and follow up on hot leads in{" "}
            <Link href="/dashboard/leads" className="font-medium text-indigo-600 hover:underline">
              Leads
            </Link>
            .
          </li>
        </ol>
      </div>
    </div>
  );
}
