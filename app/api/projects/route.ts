import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  address: z.string().trim().min(1, "Address is required.").max(500),
  reraNumber: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { documents: true, leads: true } } },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project." },
      { status: 400 }
    );
  }

  const project = await prisma.project.create({
    data: parsed.data,
  });

  return NextResponse.json({ project }, { status: 201 });
}
