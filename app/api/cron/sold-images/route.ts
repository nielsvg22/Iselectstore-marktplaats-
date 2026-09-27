// Vercel Cron worker: applies/restores sold-image overlays whose delay has
// elapsed. Runs on an interval (see vercel.json) rather than being driven
// directly by the webhook, so the "wacht X uur" setting works without any
// persistent queue/scheduler infrastructure.
import { NextRequest, NextResponse } from "next/server";
import { runDueSoldImageJobs } from "@/lib/soldImage/soldImageService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runDueSoldImageJobs();
  return NextResponse.json(result);
}
