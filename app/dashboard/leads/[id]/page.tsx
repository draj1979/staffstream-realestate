import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StageBadge from "../_components/StageBadge";
import MarkHandedOffButton from "./_components/MarkHandedOffButton";

// Live DB data — see the note in app/dashboard/leads/page.tsx.
export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      project: true,
      conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } },
      siteVisits: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead) {
    notFound();
  }

  const messages = lead.conversation?.messages ?? [];
  const latestSiteVisit = lead.siteVisits[0];

  const requirementFields = [
    ["Configuration", lead.configuration],
    ["Budget", lead.budget],
    ["Purpose", lead.purpose],
    ["Timeline", lead.timeline],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/leads" className="text-sm text-slate-500 hover:text-slate-700">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{lead.name ?? lead.whatsappNumber}</h1>
          <StageBadge stage={lead.stage} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {lead.whatsappNumber} · {lead.project.name}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-900">Conversation</h2>
          {messages.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No messages yet.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex max-w-[85%] flex-col ${message.direction === "INBOUND" ? "items-start self-start" : "items-end self-end"}`}
                >
                  <div className="mb-1 text-xs text-slate-400">
                    {message.direction === "INBOUND" ? "Lead" : "Assistant"} ·{" "}
                    {new Date(message.createdAt).toLocaleString()}
                  </div>
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                      message.direction === "INBOUND"
                        ? "rounded-tl-sm bg-slate-100 text-slate-800"
                        : "rounded-tr-sm bg-indigo-600 text-white"
                    }`}
                  >
                    {message.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-900">Requirements</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              {requirementFields.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-medium text-slate-900">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-slate-900">Site visit</h2>
            {latestSiteVisit ? (
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium text-slate-900">{latestSiteVisit.status}</dd>
                </div>
                {Array.isArray(latestSiteVisit.proposedSlots) && latestSiteVisit.proposedSlots.length > 0 && (
                  <div>
                    <dt className="text-slate-500">Proposed slots</dt>
                    <dd className="mt-0.5 font-medium text-slate-900">
                      {(latestSiteVisit.proposedSlots as string[]).join(", ")}
                    </dd>
                  </div>
                )}
                {latestSiteVisit.confirmedSlot && (
                  <div>
                    <dt className="text-slate-500">Confirmed slot</dt>
                    <dd className="mt-0.5 font-medium text-slate-900">
                      {new Date(latestSiteVisit.confirmedSlot).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No site visit proposed yet.</p>
            )}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-slate-900">Handoff</h2>
            {lead.stage === "HANDED_OFF" ? (
              <p className="mt-3 text-sm text-slate-600">
                This lead has been handed off to a human
                {lead.handoffReason ? `: ${lead.handoffReason}` : "."}
              </p>
            ) : (
              <div className="mt-3">
                <MarkHandedOffButton leadId={lead.id} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
