import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

// Credentials are resolved via Application Default Credentials: a service
// account key file (GOOGLE_APPLICATION_CREDENTIALS), `gcloud auth
// application-default login` locally, or the attached service account on
// Cloud Run in production. No key material lives in this repo.
const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID });

function bucket() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set.");
  }
  return storage.bucket(bucketName);
}

/** Keeps only the filename, dropping any path segments a client might send. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || "document.pdf";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export interface UploadedPdf {
  gcsPath: string;
  fileName: string;
}

/**
 * Uploads a PDF buffer to `documents/{projectId}/{uuid}-{filename}.pdf` and
 * returns the object path (not a signed URL — brochures aren't public).
 */
export async function uploadProjectPdf(
  projectId: string,
  fileName: string,
  buffer: Buffer
): Promise<UploadedPdf> {
  const safeName = sanitizeFileName(fileName);
  const gcsPath = `documents/${projectId}/${randomUUID()}-${safeName}`;

  await bucket().file(gcsPath).save(buffer, {
    contentType: "application/pdf",
    resumable: false,
  });

  return { gcsPath, fileName: safeName };
}

/** Downloads an object's bytes (used to relay a brochure PDF to WhatsApp). */
export async function downloadFile(gcsPath: string): Promise<Buffer> {
  const [buffer] = await bucket().file(gcsPath).download();
  return buffer;
}

/**
 * Deletes an object — used when a project (and its brochures) is deleted.
 * Best-effort by design: an already-missing object isn't an error (the
 * caller may be cleaning up after a partially-failed prior attempt).
 */
export async function deleteFile(gcsPath: string): Promise<void> {
  try {
    await bucket().file(gcsPath).delete();
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 404) return; // already gone — fine
    throw err;
  }
}
