import { headers } from "next/headers";
import { getWhatsAppSettingsStatus } from "@/lib/settings";
import WhatsAppSettingsForm from "./_components/WhatsAppSettingsForm";

// Live DB data — see the note in app/dashboard/leads/page.tsx.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getWhatsAppSettingsStatus();
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const webhookUrl = host ? `${proto}://${host}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect your own WhatsApp Business number so the assistant sends and receives on it.
        </p>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-slate-900">1. Configure the webhook in Meta</h2>
        <p className="mt-1 text-sm text-slate-500">
          In your Meta App Dashboard → WhatsApp → Configuration, set the callback URL and verify token below,
          then subscribe to the <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">messages</code> field.
        </p>
        <div className="mt-4">
          <span className="field-label">Callback URL</span>
          <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {webhookUrl}
          </code>
        </div>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-slate-900">2. WhatsApp connection details</h2>
        <p className="mt-1 text-sm text-slate-500">
          Secrets are write-only — once saved, they&apos;re never shown again here, only whether one is set.
        </p>
        <div className="mt-5">
          <WhatsAppSettingsForm initialStatus={status} />
        </div>
      </div>
    </div>
  );
}
