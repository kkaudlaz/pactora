import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "connected" }, { status: 200 });
  } catch {
    // Do not expose connection strings, hostnames, or database errors publicly.
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
