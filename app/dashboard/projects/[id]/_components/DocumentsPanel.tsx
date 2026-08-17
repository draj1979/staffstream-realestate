"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

type DocumentStatus = "PROCESSING" | "READY" | "FAILED";

interface DocumentRow {
  id: string;
  fileName: string;
  status: DocumentStatus;
  processingError: string | null;
  uploadedAt: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB, mirrors the server-side limit

export default function DocumentsPanel({
  projectId,
  initialDocuments,
}: {
  projectId: string;
  initialDocuments: DocumentRow[];
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/documents`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setDocuments(data.documents);
  }, [projectId]);

  useEffect(() => {
    const hasProcessing = documents.some((doc) => doc.status === "PROCESSING");
    if (!hasProcessing) return;

    const interval = setInterval(fetchDocuments, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  function validateAndSelect(file: File | undefined) {
    setUploadError(null);
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      setUploadError("Only PDF files are accepted.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("PDF files must be 20MB or smaller.");
      return;
    }
    setSelectedFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    validateAndSelect(event.dataTransfer.files?.[0]);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);

    const file = selectedFile ?? fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose a PDF file first.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setUploadError(data?.error ?? "Upload failed.");
        return;
      }

      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedFile(null);
      await fetchDocuments();
    } catch {
      setUploadError("Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-900">Brochure documents</h2>
        <p className="mt-1 text-sm text-slate-500">
          Uploaded PDFs are what the WhatsApp assistant reads from to answer questions about this project.
        </p>

        {documents.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">No documents uploaded yet.</p>
        ) : (
          <div className="mt-4 table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="font-medium text-slate-900">{doc.fileName}</td>
                    <td>
                      <StatusBadge status={doc.status} />
                      {doc.status === "FAILED" && doc.processingError && (
                        <p className="mt-1 max-w-sm text-xs text-red-600">{doc.processingError}</p>
                      )}
                    </td>
                    <td>{new Date(doc.uploadedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-slate-900">Upload a brochure</h2>
        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-3">
          <label
            htmlFor="brochure-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragActive ? "border-indigo-400 bg-indigo-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
            }`}
          >
            <svg width="28" height="28" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-slate-400">
              <path
                d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {selectedFile ? (
              <p className="text-sm font-medium text-slate-900">{selectedFile.name}</p>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-indigo-600">Click to choose a PDF</span> or drag and drop
                </p>
                <p className="text-xs text-slate-400">PDF only, up to 20MB</p>
              </>
            )}
            <input
              id="brochure-file"
              type="file"
              ref={fileInputRef}
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => validateAndSelect(e.target.files?.[0])}
            />
          </label>
          {uploadError && <p className="field-error">{uploadError}</p>}
          <button type="submit" disabled={uploading || !selectedFile} className="btn-primary self-start">
            {uploading ? "Uploading…" : "Upload brochure"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const styles: Record<DocumentStatus, string> = {
    PROCESSING: "bg-amber-100 text-amber-800",
    READY: "bg-emerald-100 text-emerald-800",
    FAILED: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>
  );
}
