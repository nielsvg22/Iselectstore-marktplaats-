import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { getTemplate } from "@/lib/templates/registry";
import { buildQuickProductTitles, validateQuickProductData } from "@/lib/templates/quickProduct";
import { getAttributesForProductType } from "@/lib/marktplaats/attributeCache";
import { mapProductToAttributes } from "@/lib/marktplaats/mappingEngine";
import { generateMarktplaatsDescription } from "@/lib/marktplaats/descriptionGenerator";
import { runPreflightValidation } from "@/lib/marktplaats/validator";

export const dynamic = "force-dynamic";
export async function OPTIONS(req: NextRequest) { return handleExtensionOptions(req); }
export async function POST(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  const headers = { ...auth.headers, "Cache-Control": "no-store" };
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige request body." }, { status: 400, headers }); }
  const type = String(body?.productType || "");
  const template = getTemplate(type);
  const validation = validateQuickProductData(type, body?.values || {});
  if (!template || !validation.ok) return NextResponse.json({ error: "Controleer de productgegevens.", issues: validation.issues }, { status: 400, headers });
  const data = validation.values;
  const titles = buildQuickProductTitles(type, data);
  const missingFields = template.fields.filter((f) => template.marktplaatsAttributes.includes(f.key) && !data[f.key]).map((f) => f.label);
  try {
    const { mapping, attributes, source } = await getAttributesForProductType(type);
    const results = await mapProductToAttributes(template, data, mapping.l2CategoryId, attributes);
    const check = runPreflightValidation({ template, data, categoryMapping: mapping, attributeResults: results, title: titles.marktplaatsTitle, description: generateMarktplaatsDescription(template, data, titles.shopifyTitle, null), imageCount: Math.max(0, Math.min(10, Number(body.imageCount) || 0)) });
    const filled = new Set(results.filter((r) => r.status === "mapped").map((r) => r.marktplaatsAttributeKey));
    const missingMandatory = attributes.filter((a) => a.mandatory && a.writable && !filled.has(a.key)).map((a) => a.labels.nl || a.labels["nl-NL"] || a.key);
    return NextResponse.json({ source, category: mapping.l2CategoryName, missingFields, missingMandatory, checks: check.checks.filter((c) => c.status !== "ok") }, { headers });
  } catch {
    // Missing configuration/cache is not evidence that an advert is ready.
    return NextResponse.json({ source: "unavailable", missingFields, missingMandatory: [], checks: [], message: "De categoriecontrole is niet beschikbaar. Controleer de definitieve kenmerken in Marktplaats controle voordat je een advertentie plaatst." }, { headers });
  }
}
