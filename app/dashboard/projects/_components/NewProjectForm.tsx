"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [reraNumber, setReraNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address,
          reraNumber: reraNumber || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create project.");
        return;
      }

      setName("");
      setAddress("");
      setReraNumber("");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card max-w-lg">
      <h2 className="text-sm font-semibold text-slate-900">New project</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="project-name" className="field-label">
            Name
          </label>
          <input
            id="project-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
            placeholder="e.g. Palm Meadows Residency"
          />
        </div>
        <div>
          <label htmlFor="project-address" className="field-label">
            Address
          </label>
          <input
            id="project-address"
            type="text"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="field-input"
          />
        </div>
        <div>
          <label htmlFor="project-rera" className="field-label">
            RERA number <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="project-rera"
            type="text"
            value={reraNumber}
            onChange={(e) => setReraNumber(e.target.value)}
            className="field-input"
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary self-start">
          {submitting ? "Creating…" : "Create project"}
        </button>
      </form>
    </div>
  );
}
