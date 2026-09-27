import { NextRequest, NextResponse } from "next/server";
import { getSoldImageSettings, updateSoldImageSettings } from "@/lib/soldImage/settingsService";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSoldImageSettings();
  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige request body." }, { status: 400 });
  }

  if (body.mode && !["none", "auto"].includes(body.mode)) {
    return NextResponse.json({ error: "Ongeldige mode." }, { status: 400 });
  }
  if (body.position && !["center", "top-left", "top-right", "bottom-left", "bottom-right"].includes(body.position)) {
    return NextResponse.json({ error: "Ongeldige positie." }, { status: 400 });
  }

  const settings = await updateSoldImageSettings(body);
  return NextResponse.json({ settings });
}
