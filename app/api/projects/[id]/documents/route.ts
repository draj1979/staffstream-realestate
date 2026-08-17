import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { uploadProjectPdf } from "@/lib/gcs";
import { processUploadedDocument } from "@/lib/documents";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB
const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

type RouteContext = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().min(1).max(191) });

export async function GET(_request: Request, { params }: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }
  const { id: projectId } = parsedParams.data;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const documents = await prisma.document.findMany({
    where: { projectId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      status: true,
      processingError: true,
      uploadedAt: true,
    },
  });

  return NextResponse.json({ documents });
}

export async function POST(request: Request, { params }: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }
  const { id: projectId } = parsedParams.data;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const extensionOk = /\.pdf$/i.test(file.name);
  const mimeOk = !file.type || file.type === "application/pdf" || file.type === "application/octet-stream";
  if (!extensionOk || !mimeOk) {
    return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF files must be 20MB or smaller." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Extension/MIME can be spoofed by the client — check the actual file
  // header too.
  if (!buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES)) {
    return NextResponse.json({ error: "This file is not a valid PDF." }, { status: 400 });
  }

  const { gcsPath, fileName } = await uploadProjectPdf(projectId, file.name, buffer);

  const document = await prisma.document.create({
    data: {
      projectId,
      fileName,
      gcsPath,
      status: "PROCESSING",
    },
  });

  // Fire-and-forget: don't block the response on text extraction. The UI
  // polls GET /api/projects/[id]/documents for the status to flip to
  // READY/FAILED.
  void processUploadedDocument(document.id, buffer);

  return NextResponse.json({ document }, { status: 201 });
}
