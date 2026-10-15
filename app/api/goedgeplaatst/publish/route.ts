import { NextRequest, NextResponse } from "next/server";
import { publishAdToMarktplaats } from "@/lib/goedgeplaatst/service";
import { checkAdminPassword } from "@/lib/adminAuth";
import { ForbiddenEndpointError } from "@/lib/goedgeplaatst/config";
import { GoedgeplaatstConfigError } from "@/lib/goedgeplaatst/client";

export const dynamic = "force-dynamic";

interface PublishBody {
  adId: number;
}

/**
 * THE ONE route that can put a real, public advertisement live on
 * Marktplaats — separate from create-ad on purpose, so creating/updating a
 * concept can never accidentally publish it. Blocked outright unless
 * GOEDGEPLAATST_ALLOW_PUBLISH=true (see lib/goedgeplaatst/config.ts's
 * assertEndpointAllowed, the actual guard — this route does not duplicate
 * that logic, it just surfaces the resulting error clearly).
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: PublishBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }

  const adId = Number(body.adId);
  if (!Number.isFinite(adId) || adId <= 0) {
    return NextResponse.json({ error: "adId (number) is verplicht." }, { status: 400 });
  }

  try {
    const result = await publishAdToMarktplaats(adId);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof ForbiddenEndpointError) {
      return NextResponse.json(
        { error: "Publiceren staat uit. Zet GOEDGEPLAATST_ALLOW_PUBLISH=true om dit expliciet toe te staan." },
        { status: 403 }
      );
    }
    const status = err instanceof GoedgeplaatstConfigError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status });
  }
}
