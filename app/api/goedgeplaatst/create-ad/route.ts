import { NextRequest, NextResponse } from "next/server";
import { createConceptAd } from "@/lib/goedgeplaatst/service";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { checkAdminPassword } from "@/lib/adminAuth";
import { GoedgeplaatstConfigError } from "@/lib/goedgeplaatst/client";

export const dynamic = "force-dynamic";

interface CreateAdBody {
  /** Client-generated, stable for the lifetime of one test session — the idempotency key (see service.ts createConceptAd). */
  idempotencyKey: string;
  categoryId: number;
  shopifyProductId?: string;
  manual?: {
    title: string;
    description: string;
    priceEuros: number;
    imageUrls: string[];
  };
}

function validateManual(manual: CreateAdBody["manual"]): string | null {
  if (!manual) return "manual is verplicht wanneer shopifyProductId ontbreekt.";
  if (!manual.title || manual.title.trim().length < 5 || manual.title.length > 60) return "Titel moet 5-60 tekens zijn.";
  if (!manual.description || manual.description.trim().length < 5) return "Omschrijving moet minimaal 5 tekens zijn.";
  if (!Number.isFinite(manual.priceEuros) || manual.priceEuros <= 0) return "Verkoopprijs moet een positief getal zijn.";
  if (!Array.isArray(manual.imageUrls)) return "imageUrls moet een array zijn.";
  return null;
}

/**
 * Mutating action (STAP 10 toegangscontrole): creates a GoedGeplaatst
 * concept advertisement — POST /ads/ with status="concept" only, optionally
 * PUT /images/<adId>. Never calls a publish endpoint (see
 * lib/goedgeplaatst/config.ts assertEndpointAllowed — a hard guard, not just
 * this check).
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: CreateAdBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }

  if (!body.idempotencyKey || typeof body.idempotencyKey !== "string") {
    return NextResponse.json({ error: "idempotencyKey is verplicht." }, { status: 400 });
  }
  if (!Number.isFinite(Number(body.categoryId))) {
    return NextResponse.json({ error: "categoryId (number) is verplicht — kies een categorie uit de live/mock categorielijst." }, { status: 400 });
  }

  try {
    if (body.shopifyProductId) {
      const preview = await buildProductPreview(body.shopifyProductId);
      const linkKey = `shopify:${body.shopifyProductId}`;
      const result = await createConceptAd({ linkKey, shopifyProductId: body.shopifyProductId, categoryId: Number(body.categoryId), preview });
      return NextResponse.json({ result });
    }

    const manualError = validateManual(body.manual);
    if (manualError) return NextResponse.json({ error: manualError }, { status: 400 });

    const linkKey = `manual:${body.idempotencyKey}`;
    const result = await createConceptAd({
      linkKey,
      shopifyProductId: null,
      categoryId: Number(body.categoryId),
      manual: { ...body.manual!, imageUrls: body.manual!.imageUrls.filter((u) => typeof u === "string" && u.trim().length > 0) },
    });
    return NextResponse.json({ result });
  } catch (err) {
    const status = err instanceof GoedgeplaatstConfigError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status });
  }
}
