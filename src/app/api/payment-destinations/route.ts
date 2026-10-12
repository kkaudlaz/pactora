import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { appendAuditEntry } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANKS = new Set(["BDO", "BPI", "Metrobank", "UnionBank", "LandBank", "Other"]);
const MAX_IMAGE_DATA_LENGTH = 1_400_000;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function validImageData(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_IMAGE_DATA_LENGTH
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const loans = await prisma.loan.findMany({
    where: { OR: [{ borrowerId: session.id }, { lenderId: session.id }] },
    select: { lenderId: true },
  });
  const lenderIds = [...new Set([session.id, ...loans.map((loan) => loan.lenderId)])];
  const destinations = await prisma.paymentDestination.findMany({
    where: { lenderId: { in: lenderIds } },
    orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    select: { id: true, lenderId: true, method: true, provider: true, recipientName: true, accountLabel: true, qrImageData: true, updatedAt: true },
  });
  return NextResponse.json({ destinations });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payment destination details are required." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const method = input.method;
  if (method !== "GCASH" && method !== "BANK_TRANSFER") return NextResponse.json({ error: "Choose GCash or bank transfer." }, { status: 400 });
  const provider = method === "GCASH" ? "GCash" : cleanText(input.provider, 40);
  if (!provider || (method === "BANK_TRANSFER" && !BANKS.has(provider))) return NextResponse.json({ error: "Choose a supported bank destination." }, { status: 400 });
  if (!validImageData(input.qrImageData)) return NextResponse.json({ error: "Upload a PNG, JPG, or WebP QR image smaller than 1 MB." }, { status: 400 });

  const recipientName = cleanText(input.recipientName, 100);
  const accountLabel = cleanText(input.accountLabel, 100);
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentDestination.findUnique({
        where: { lenderId_method_provider: { lenderId: session.id, method, provider } },
        select: { id: true },
      });
      const destination = await tx.paymentDestination.upsert({
        where: { lenderId_method_provider: { lenderId: session.id, method, provider } },
        create: { lenderId: session.id, method, provider, recipientName, accountLabel, qrImageData: input.qrImageData as string },
        update: { recipientName, accountLabel, qrImageData: input.qrImageData as string },
        select: { id: true, lenderId: true, method: true, provider: true, recipientName: true, accountLabel: true, qrImageData: true, updatedAt: true },
      });
      await appendAuditEntry(tx, {
        entityType: "PAYMENT_DESTINATION",
        entityId: destination.id,
        eventType: existing ? "PAYMENT_DESTINATION_UPDATED" : "PAYMENT_DESTINATION_CREATED",
        actorMemberId: session.id,
        idempotencyKey: randomUUID(),
        payload: { method, provider, recipientName, accountLabel, imageUpdated: true },
      });
      return destination;
    });
    return NextResponse.json({ destination: saved });
  } catch {
    return NextResponse.json({ error: "Could not save the payment QR. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Payment destination is required." }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const destination = await tx.paymentDestination.findFirst({ where: { id, lenderId: session.id } });
      if (!destination) throw new Error("NOT_FOUND");
      await tx.paymentDestination.delete({ where: { id: destination.id } });
      await appendAuditEntry(tx, {
        entityType: "PAYMENT_DESTINATION",
        entityId: destination.id,
        eventType: "PAYMENT_DESTINATION_DELETED",
        actorMemberId: session.id,
        idempotencyKey: randomUUID(),
        payload: { method: destination.method, provider: destination.provider },
      });
      return destination;
    });
    return NextResponse.json({ deleted: true, id: result.id });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Payment destination not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not remove the payment QR. Please try again." }, { status: 500 });
  }
}
