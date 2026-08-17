// SITE_VISIT_SCHEDULED and HANDED_OFF are the stages that need the
// builder's attention — solid, bold badges. Everything else is a lighter
// "still in progress" tint.
const STAGE_STYLES: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-600",
  GREETED: "bg-sky-100 text-sky-700",
  QUALIFYING: "bg-sky-100 text-sky-700",
  QUALIFIED: "bg-indigo-100 text-indigo-700",
  FOLLOWUP: "bg-amber-100 text-amber-800",
  SITE_VISIT_SCHEDULED: "bg-emerald-600 text-white font-semibold",
  HANDED_OFF: "bg-red-600 text-white font-semibold",
  LOST: "bg-slate-100 text-slate-400",
};

const STAGE_LABELS: Record<string, string> = {
  SITE_VISIT_SCHEDULED: "SITE VISIT SCHEDULED",
  HANDED_OFF: "HANDED OFF",
};

export default function StageBadge({ stage }: { stage: string }) {
  const style = STAGE_STYLES[stage] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs tracking-wide ${style}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
