import { listProducts } from "../shopify/client";
import { buildProductPreview } from "./orchestrator";
import { getTemplate } from "../templates/registry";
import { getAttributeMapping } from "./mappingEngine";

/**
 * Builds the XML feed Marktplaats Zakelijk/Admarkt polls once a day (see
 * GET /api/marktplaats/feed). Schema verified live against
 * https://admarkt.marktplaats.nl/api/sellside/feed/xsd — only fields that
 * exist there are emitted, and every element uses the documented
 * "admarkt:" prefix (every example in Marktplaats' own docs uses it, so we
 * match it exactly rather than relying on default-namespace equivalence).
 *
 * Category IDs and attribute keys are real (not the mock_-prefixed
 * placeholders used elsewhere) only once a browser-test run has actually
 * selected that category/field on the live site — see
 * browserTest/browserTestPublisher.ts's category/attribute "discovery"
 * persistence. A product whose category hasn't been discovered yet is
 * skipped rather than sent with a fake categoryId.
 */

const NS = "http://admarkt.marktplaats.nl/schemas/1.0";

const CONDITION_MAP: Record<string, "new" | "refurbished" | "used"> = {
  "Als nieuw": "refurbished",
  "Zeer nette staat": "used",
  "Nette staat": "used",
  "Zichtbare gebruikssporen": "used",
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Marktplaats feed only accepts latin-1 — strip anything outside it (and any URL, which it drops anyway). */
function sanitizeText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .split("")
    .filter((ch) => ch.charCodeAt(0) <= 255)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds <attributes> straight from the discovered real key (DB) + Shopify
 * value — deliberately NOT via mappingEngine.mapProductToAttributes(), which
 * also requires the key to exist in attributeCache's category-attribute
 * catalog. That catalog is always the mock_-prefixed set here (every
 * category mapping in this deployment is DB-driven, not the live API's),
 * so a real discovered key (e.g. "storage") never matches an entry there
 * and gets wrongly rejected as "no_matching_attribute" even though the
 * browser test just proved the field exists and the value fits.
 */
async function buildAttributesXml(l2CategoryId: string, data: Record<string, string>, attributeFields: string[]): Promise<string> {
  const fieldMapping = await getAttributeMapping(l2CategoryId);
  const entries = attributeFields
    .map((field) => ({ field, key: fieldMapping[field], value: data[field] }))
    .filter((e) => e.key && e.value && e.value.trim().length > 0);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      (e) =>
        `      <admarkt:attribute>\n        <admarkt:attributeName>${xmlEscape(
          e.key
        )}</admarkt:attributeName>\n        <admarkt:attributeValue>${xmlEscape(e.value)}</admarkt:attributeValue>\n      </admarkt:attribute>`
    )
    .join("\n");
  return `    <admarkt:attributes>\n${items}\n    </admarkt:attributes>\n`;
}

function buildMediaXml(imageUrls: string[]): string {
  if (imageUrls.length === 0) return "";
  const items = imageUrls.map((url) => `      <admarkt:image url="${xmlEscape(url)}" />`).join("\n");
  return `    <admarkt:media>\n${items}\n    </admarkt:media>\n`;
}

export interface FeedBuildResult {
  xml: string;
  included: number;
  skipped: { shopifyProductId: string; reason: string }[];
}

export async function buildFeedXml(): Promise<FeedBuildResult> {
  const products = await listProducts(250);
  const storefrontUrl = (process.env.SHOPIFY_STOREFRONT_URL || "").replace(/\/$/, "");
  const ads: string[] = [];
  const skipped: { shopifyProductId: string; reason: string }[] = [];

  for (const product of products) {
    const id = String(product.id);
    if (!getTemplate(product.product_type)) {
      skipped.push({ shopifyProductId: id, reason: `geen template voor producttype "${product.product_type}"` });
      continue;
    }
    const inStock = product.variants.some((v) => v.inventory_management === null || v.inventory_quantity > 0);
    if (!inStock) {
      skipped.push({ shopifyProductId: id, reason: "niet op voorraad" });
      continue;
    }

    let preview;
    try {
      preview = await buildProductPreview(id);
    } catch (err) {
      skipped.push({ shopifyProductId: id, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (!preview.validation.publishable) {
      skipped.push({ shopifyProductId: id, reason: "validatie niet publiceerbaar" });
      continue;
    }

    const l2 = preview.categoryMapping?.l2CategoryId;
    if (!l2 || l2 === "UNVERIFIED" || Number.isNaN(Number(l2))) {
      skipped.push({ shopifyProductId: id, reason: "categorie-ID nog niet ontdekt — draai eerst een browsertest voor dit producttype" });
      continue;
    }

    const title = sanitizeText(preview.marktplaatsTitle).slice(0, 60);
    const description = sanitizeText(preview.marktplaatsDescription);
    const condition = CONDITION_MAP[preview.data.condition ?? ""] ?? "used";
    const url = product.handle && storefrontUrl ? `${storefrontUrl}/products/${product.handle}` : undefined;
    const attributesXml = await buildAttributesXml(l2, preview.data, preview.template.marktplaatsAttributes);

    const ad = `  <admarkt:ad>
    <admarkt:vendorId>${xmlEscape(id)}</admarkt:vendorId>
    <admarkt:categoryId>${xmlEscape(l2)}</admarkt:categoryId>
    <admarkt:title>${xmlEscape(title)}</admarkt:title>
    <admarkt:description>${xmlEscape(description)}</admarkt:description>
    <admarkt:price>${Math.round(preview.price)}</admarkt:price>
    <admarkt:priceType>FIXED_PRICE</admarkt:priceType>
    <admarkt:condition>${condition}</admarkt:condition>
${url ? `    <admarkt:url>${xmlEscape(url)}</admarkt:url>\n` : ""}${attributesXml}${buildMediaXml(preview.imageUrls)}  </admarkt:ad>`;

    ads.push(ad);
  }

  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<admarkt:ads xmlns:admarkt="${NS}">\n${ads.join("\n")}\n</admarkt:ads>\n`;

  return { xml, included: ads.length, skipped };
}
