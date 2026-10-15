import { NextResponse } from "next/server";
import { listConceptAds } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only: GET /ads/?status=concept. */
export async function GET() {
  try {
    const result = await listConceptAds();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
