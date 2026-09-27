import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/marktplaats/connectionService";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getConnectionStatus();
  return NextResponse.json({ status });
}
