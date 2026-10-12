import { NextResponse } from "next/server";
import { testConnection } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only — safe per STAP 4 ("eerst een gedocumenteerd read-only endpoint"). */
export async function GET() {
  try {
    const status = await testConnection();
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
