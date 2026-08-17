"use client";

import { useState, type FormEvent } from "react";

interface Status {
  phoneNumberId: string | null;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  source: "database" | "environment";
}

export default function WhatsAppSettingsForm({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState(initialStatus);
  const [phoneNumberId, setPhoneNumberId] = useState(initialStatus.phoneNumberId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);

    try {
      const res = await fetch("/api/settings/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId: phoneNumberId || undefined,
          accessToken: accessToken || undefined,
          appSecret: appSecret || undefined,
          verifyToken: verifyToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to save settings.");
        return;
      }

      const data: Status = await res.json();
      setStatus(data);
      // Secret fields are write-only — clear them after a successful save
      // rather than ever echoing a value back.
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      setSaved(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="phoneNumberId" className="field-label">
          WhatsApp phone number ID
        </label>
        <input
          id="phoneNumberId"
          type="text"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="field-input"
          placeholder="e.g. 109876543210987"
        />
        <p className="field-hint">From your Meta App Dashboard → WhatsApp → API Setup.</p>
      </div>

      <div>
        <label htmlFor="accessToken" className="field-label">
          Access token {status.hasAccessToken && <ConfiguredTag />}
        </label>
        <input
          id="accessToken"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          className="field-input"
          placeholder={status.hasAccessToken ? "•••••••••••••••• (leave blank to keep current)" : "Paste your access token"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="appSecret" className="field-label">
          App secret {status.hasAppSecret && <ConfiguredTag />}
        </label>
        <input
          id="appSecret"
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          className="field-input"
          placeholder={status.hasAppSecret ? "•••••••••••••••• (leave blank to keep current)" : "Used to verify inbound webhook signatures"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="verifyToken" className="field-label">
          Verify token {status.hasVerifyToken && <ConfiguredTag />}
        </label>
        <input
          id="verifyToken"
          type="text"
          value={verifyToken}
          onChange={(e) => setVerifyToken(e.target.value)}
          className="field-input"
          placeholder={status.hasVerifyToken ? "Leave blank to keep current" : "Any string you choose — enter the same value in Meta"}
        />
      </div>

      {error && <p className="field-error">{error}</p>}
      {saved && <p className="text-sm font-medium text-emerald-600">Settings saved.</p>}

      <button type="submit" disabled={submitting} className="btn-primary self-start">
        {submitting ? "Saving…" : "Save WhatsApp settings"}
      </button>
    </form>
  );
}

function ConfiguredTag() {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      configured
    </span>
  );
}
