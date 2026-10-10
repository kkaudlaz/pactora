import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedMember } from "@/lib/session";
import { parsePhpToCentavos } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Owner access only." }, { status: 403 });
  const purchases = await prisma.personalPurchase.findMany({
    where: { ownerId: session.id },
    include: { payments: { orderBy: { paidAt: "desc" } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ purchases: purchases.map((purchase) => ({
    ...purchase,
    totalAmountCentavos: purchase.totalAmountCentavos.toString(),
    downPaymentCentavos: purchase.downPaymentCentavos.toString(),
    payments: purchase.payments.map((payment) => ({ ...payment, amountCentavos: payment.amountCentavos.toString() })),
  })) });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedMember();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Owner access only." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Purchase details are required." }, { status: 400 });
  const data = body as Record<string, unknown>;
  const purchaseType = data.purchaseType;
  const category = typeof data.category === "string" ? data.category.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const merchant = typeof data.merchant === "string" ? data.merchant.trim().slice(0, 160) : "";
  if (purchaseType !== "CREDIT_CARD" && purchaseType !== "INSTALLMENT") return NextResponse.json({ error: "Choose Credit Card or Installment." }, { status: 400 });
  if (!category || category.length > 60 || !description || description.length > 300) return NextResponse.json({ error: "Enter a category and description (maximum 300 characters)." }, { status: 400 });
  let total: bigint; let down: bigint;
  try { total = parsePhpToCentavos(String(data.totalAmountPhp ?? "")); down = data.downPaymentPhp ? parsePhpToCentavos(String(data.downPaymentPhp)) : 0n; }
  catch { return NextResponse.json({ error: "Enter valid PHP amounts." }, { status: 400 }); }
  if (total <= 0n || down < 0n || down > total) return NextResponse.json({ error: "Total must be positive and down payment cannot exceed total." }, { status: 400 });
  const installmentCount = data.installmentCount === "" || data.installmentCount == null ? null : Number(data.installmentCount);
  if (purchaseType === "INSTALLMENT" && (!Number.isInteger(installmentCount) || Number(installmentCount) < 1 || Number(installmentCount) > 120)) return NextResponse.json({ error: "Installments must be between 1 and 120." }, { status: 400 });
  const date = (value: unknown) => typeof value === "string" && value ? new Date(value + (value.length === 10 ? "T12:00:00" : "")) : null;
  const dueAt = date(data.dueAt);
  const statementDate = date(data.statementDate);
  if ((dueAt && Number.isNaN(dueAt.getTime())) || (statementDate && Number.isNaN(statementDate.getTime()))) return NextResponse.json({ error: "Enter valid dates." }, { status: 400 });
  const purchase = await prisma.personalPurchase.create({
    data: { id: randomUUID(), ownerId: session.id, purchaseType, category, description, merchant: merchant || null, totalAmountCentavos: total, downPaymentCentavos: down, installmentCount: purchaseType === "INSTALLMENT" ? installmentCount : null, dueAt, statementDate },
    include: { payments: true },
  });
  return NextResponse.json({ purchase: { ...purchase, totalAmountCentavos: total.toString(), downPaymentCentavos: down.toString(), payments: [] } }, { status: 201 });
}
