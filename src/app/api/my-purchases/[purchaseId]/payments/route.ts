import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { parsePhpToCentavos } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ purchaseId: string }> }) {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Owner access only." }, { status: 403 });
  const { purchaseId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  let amount: bigint;
  try { amount = parsePhpToCentavos(String(data.amountPhp ?? "")); } catch { return NextResponse.json({ error: "Enter a valid PHP payment." }, { status: 400 }); }
  if (amount <= 0n) return NextResponse.json({ error: "Payment must be greater than zero." }, { status: 400 });
  const purchase = await prisma.personalPurchase.findFirst({ where: { id: purchaseId, ownerId: session.id }, include: { payments: true } });
  if (!purchase) return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
  const paid = purchase.payments.reduce((sum, payment) => sum + payment.amountCentavos, 0n);
  const outstanding = purchase.totalAmountCentavos - purchase.downPaymentCentavos - paid;
  if (amount > outstanding) return NextResponse.json({ error: "Payment exceeds the outstanding amount." }, { status: 400 });
  const payment = await prisma.personalPurchasePayment.create({ data: { id: randomUUID(), purchaseId, amountCentavos: amount, note: typeof data.note === "string" ? data.note.trim().slice(0, 500) || null : null } });
  return NextResponse.json({ payment: { ...payment, amountCentavos: amount.toString() } }, { status: 201 });
}
