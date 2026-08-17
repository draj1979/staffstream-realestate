import { prisma } from "@/lib/prisma";
import { extractPdfText, isNearEmptyExtraction } from "@/lib/pdf";

export const SCANNED_PDF_MESSAGE =
  "This PDF appears to be scanned/image-based and couldn't be read — OCR isn't supported in this MVP; try a text-based export of the brochure.";

const UNREADABLE_PDF_MESSAGE =
  "We couldn't read this file as a PDF. It may be corrupted or not actually a PDF — try re-exporting and uploading again.";

/**
 * Runs text extraction for a just-uploaded Document and updates its status
 * to READY or FAILED. Intended to be called without awaiting (fire-and-
 * forget) right after the upload response is sent — see
 * POST /api/projects/[id]/documents.
 */
export async function processUploadedDocument(documentId: string, buffer: Buffer): Promise<void> {
  try {
    const { text, pageCount } = await extractPdfText(buffer);

    if (isNearEmptyExtraction(text, pageCount)) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "FAILED", processingError: SCANNED_PDF_MESSAGE, extractedText: null },
      });
      return;
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "READY", extractedText: text, processingError: null },
    });
  } catch (err) {
    console.error(`[documents] extraction failed for document ${documentId}:`, err);
    try {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "FAILED", processingError: UNREADABLE_PDF_MESSAGE, extractedText: null },
      });
    } catch (updateErr) {
      console.error(`[documents] failed to mark document ${documentId} as FAILED:`, updateErr);
    }
  }
}
