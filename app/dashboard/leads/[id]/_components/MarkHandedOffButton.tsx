"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkHandedOffButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirm("Mark this lead as handed off? The AI will stop replying to them.")) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/handoff`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to hand off this lead.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={submitting} className="btn-secondary w-full">
        {submitting ? "Marking…" : "Mark as handed off"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
