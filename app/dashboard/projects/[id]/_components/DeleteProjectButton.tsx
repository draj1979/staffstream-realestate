"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function DeleteProjectButton({
  projectId,
  projectName,
  leadCount,
  documentCount,
}: {
  projectId: string;
  projectName: string;
  leadCount: number;
  documentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canConfirm = confirmText.trim() === projectName;

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to delete this project.");
        return;
      }
      router.push("/dashboard/projects");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-danger">
        Delete project
      </button>
    );
  }

  return (
    <div className="card border-red-200 bg-red-50">
      <h2 className="text-sm font-semibold text-red-900">Delete &quot;{projectName}&quot;</h2>
      <p className="mt-2 text-sm text-red-800">
        This permanently deletes this project, its {documentCount} brochure document
        {documentCount === 1 ? "" : "s"} (including the files in storage), and all {leadCount} lead
        {leadCount === 1 ? "" : "s"} with their full conversation history and site visits. This cannot be undone.
      </p>
      <form onSubmit={handleDelete} className="mt-4 flex flex-col gap-3">
        <div>
          <label htmlFor="confirm-name" className="field-label text-red-900">
            Type <span className="font-mono">{projectName}</span> to confirm
          </label>
          <input
            id="confirm-name"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="field-input border-red-300"
            autoComplete="off"
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={!canConfirm || deleting} className="btn-danger">
            {deleting ? "Deleting…" : "Permanently delete"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmText("");
              setError(null);
            }}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
