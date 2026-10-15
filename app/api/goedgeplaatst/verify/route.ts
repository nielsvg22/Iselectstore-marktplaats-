import { NextRequest, NextResponse } from "next/server";
import { verifyAd } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only: GET /ads/ + GET /status/<userId>/<adId>. */
export async function GET(req: NextRequest) {
  const linkKey = req.nextUrl.searchParams.get("linkKey");
  if (!linkKey) {
    return NextResponse.json({ error: "linkKey query-parameter is verplicht." }, { status: 400 });
  }
  try {
    const result = await verifyAd(linkKey);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
