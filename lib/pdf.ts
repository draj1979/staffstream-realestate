import { PDFParse } from "pdf-parse";

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
}

/**
 * Extracts all text from a PDF buffer. Throws if the file isn't a parseable
 * PDF at all (corrupt/not actually a PDF) — near-empty-text detection
 * (scanned/image-only PDFs) is the caller's job, since "parsed fine but has
 * no text" isn't an exception here.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text ?? "", pageCount: result.total ?? 0 };
  } finally {
    await parser.destroy();
  }
}

// Below this many non-whitespace characters per page, we treat the PDF as
// effectively textless — almost always a scanned/image-only brochure that
// produced no (or only stray/OCR-noise) extractable text.
const MIN_CHARS_PER_PAGE = 20;

export function isNearEmptyExtraction(text: string, pageCount: number): boolean {
  const meaningfulChars = text.replace(/\s/g, "").length;
  const pages = Math.max(pageCount, 1);
  return meaningfulChars < MIN_CHARS_PER_PAGE * pages;
}
