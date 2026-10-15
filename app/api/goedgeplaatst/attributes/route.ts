import { NextRequest, NextResponse } from "next/server";
import { listAttributesForCategory } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only: POST /attributes/ at GoedGeplaatst. Body: { categoryId: number }. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const categoryId = Number(body?.categoryId);
    if (!Number.isFinite(categoryId)) {
      return NextResponse.json({ error: "categoryId (number) is verplicht." }, { status: 400 });
    }
    const result = await listAttributesForCategory(categoryId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
