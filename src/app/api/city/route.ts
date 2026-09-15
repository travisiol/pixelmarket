import { NextResponse } from "next/server";
import { readCity } from "@/lib/server/city";

export const dynamic = "force-dynamic";

/** The whole city, read from the chain and served from a 12 s memory cache. */
export async function GET() {
  const city = await readCity();
  return NextResponse.json(city, { headers: { "cache-control": "no-store" } });
}
