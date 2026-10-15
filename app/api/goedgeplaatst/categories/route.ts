import { NextResponse } from "next/server";
import { listCategories } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only: POST /categories/ at GoedGeplaatst, exposed here as GET since it never mutates anything. */
export async function GET() {
  try {
    const result = await listCategories();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
