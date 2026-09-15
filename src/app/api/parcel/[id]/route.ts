import { NextResponse } from "next/server";
import { readParcelDetail } from "@/lib/server/city";

export const dynamic = "force-dynamic";

/** Holders, recent trades and the creator's escrow balance for one parcel. */
export async function GET(_request: Request, context: RouteContext<"/api/parcel/[id]">) {
  const { id } = await context.params;
  const n = Number.parseInt(id, 10);
  if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: "bad parcel id" }, { status: 400 });
  const detail = await readParcelDetail(n);
  if (!detail) return NextResponse.json({ error: "no such parcel" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
}
