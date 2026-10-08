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
 * IMPORTANT: categoryId here is NOT the same ID space as
 * marktplaats_category_mapping (browserTest/browserTestPublisher.ts's
 * category "discovery"). That table's IDs come from the <select> options on
 * the live CONSUMER posting form (marktplaats.nl/plaats) and are only valid
 * for driving that form — confirmed by live testing that l2CategoryId "225"
 * from that table (meant for iPhone) is actually "Boeken > Fantasy" in the
 * Admarkt feed's own taxonomy. The Admarkt taxonomy is fetched fresh from
 * the public, unauthenticated GET https://admarkt.marktplaats.nl/api/sellside/
 * category/0?levels=9999 (Accept: application/sellside.category-v5+json) —
 * ADMARKT_CATEGORY_MAP below is a one-time lookup against that real tree,
 * independent of whatever the browser-test discovery table contains.
 */

const NS = "http://admarkt.marktplaats.nl/schemas/1.0";

/**
 * Admarkt leaf category IDs per Shopify product type — looked up against the
 * live Admarkt category taxonomy (see the IMPORTANT note above), NOT against
 * marktplaats_category_mapping. Re-verify here if a new product type is
 * added or Marktplaats restructures a category.
 */
const ADMARKT_CATEGORY_MAP: Record<string, string> = {
  iPhone: "1953", // Telecommunicatie > Mobiele telefoons | Apple iPhone
  iPad: "2722", // Computers en Software > Apple iPads
  MacBook: "325", // Computers en Software > Apple Macbooks
  iMac: "324", // Computers en Software > Apple Desktops
  "Mac mini": "324", // Computers en Software > Apple Desktops
  "Apple Watch": "3041", // Sieraden, Tassen en Uiterlijk > Smartwatches
};

const CONDITION_MAP: Record<string, "new" | "refurbished" | "used"> = {
  "Als nieuw": "refurbished",
  "Zeer nette staat": "used",
  "Nette staat": "used",
  "Zichtbare gebruikssporen": "used",
};

/**
 * The attribute-level "condition" key (separate from the top-level
 * <admarkt:condition> element above) has its own enum, verified against
 * category 1953's live attributeGroups: ["Nieuw", "Refurbished",
 * "Zo goed als nieuw", "Gebruikt", "Niet werkend"] — our own 4-tier Dutch
 * condition vocabulary (lib/templates/types.ts) doesn't match any of those
 * strings verbatim, so send only "Zo goed als nieuw" (still like new) or
 * "Gebruikt" (used, same object offered on either side of that split).
 */
const CONDITION_ATTRIBUTE_MAP: Record<string, string> = {
  "Als nieuw": "Zo goed als nieuw",
  "Zeer nette staat": "Zo goed als nieuw",
  "Nette staat": "Gebruikt",
  "Zichtbare gebruikssporen": "Gebruikt",
};

/**
 * The "storage" attribute's value enum is unit-suffixed ("256 GB", "1 TB" —
 * verified against category 1953's live attributeGroups), but
 * FIELD_LIBRARY.storage_gb (lib/templates/types.ts) stores a bare number.
 */
function formatStorageValue(rawGb: string): string {
  const gb = Number(rawGb);
  if (!Number.isFinite(gb) || gb <= 0) return rawGb;
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Strips URLs (Marktplaats drops them anyway) and collapses whitespace.
 * The file itself is UTF-8 (per https://ecg-icas.github.io/icas/doc/prod/feeds.html#file-format
 * — "Feeds are expected to be in UTF-8 encoding"), so Dutch diacritics etc. are
 * fine here; only free-text field *values* like campaignVendorId are
 * documented as latin-1-restricted, which doesn't apply to title/description.
 */
function sanitizeText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "")
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
    .map((field) => {
      const key = fieldMapping[field];
      let value = data[field];
      // Discovered key NAMES (e.g. "storage", "condition") are correct —
      // only the Admarkt categoryId numbering differs from the browser-test
      // discovery table's — but their VALUE formats still need converting to
      // match Admarkt's own enum (verified live against category 1953).
      if (key === "storage" && value) value = formatStorageValue(value);
      if (key === "condition" && value) value = CONDITION_ATTRIBUTE_MAP[value] ?? value;
      return { field, key, value };
    })
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

    const admarktCategoryId = ADMARKT_CATEGORY_MAP[preview.productType];
    if (!admarktCategoryId) {
      skipped.push({ shopifyProductId: id, reason: `geen Admarkt-categorie-ID bekend voor producttype "${preview.productType}"` });
      continue;
    }

    // Still used as the lookup key into marktplaats_attribute_mapping — that
    // table's discovered attribute KEY NAMES (e.g. "storage") are correct
    // even though its categoryId numbering isn't (see the module doc above).
    const l2 = preview.categoryMapping?.l2CategoryId;
    if (!l2 || l2 === "UNVERIFIED" || Number.isNaN(Number(l2))) {
      skipped.push({ shopifyProductId: id, reason: "attribuutsleutels nog niet ontdekt — draai eerst een browsertest voor dit producttype" });
      continue;
    }

    const title = sanitizeText(preview.marktplaatsTitle).slice(0, 60);
    const description = sanitizeText(preview.marktplaatsDescription);
    const condition = CONDITION_MAP[preview.data.condition ?? ""] ?? "used";
    const url = product.handle && storefrontUrl ? `${storefrontUrl}/products/${product.handle}` : undefined;
    const attributesXml = await buildAttributesXml(l2, preview.data, preview.template.marktplaatsAttributes);

    const ad = `  <admarkt:ad>
    <admarkt:vendorId>${xmlEscape(id)}</admarkt:vendorId>
    <admarkt:categoryId>${xmlEscape(admarktCategoryId)}</admarkt:categoryId>
    <admarkt:title>${xmlEscape(title)}</admarkt:title>
    <admarkt:description>${xmlEscape(description)}</admarkt:description>
    <admarkt:price>${Math.round(preview.price)}</admarkt:price>
    <admarkt:priceType>FIXED_PRICE</admarkt:priceType>
    <admarkt:condition>${condition}</admarkt:condition>
${url ? `    <admarkt:url>${xmlEscape(url)}</admarkt:url>\n` : ""}${attributesXml}${buildMediaXml(preview.imageUrls)}  </admarkt:ad>`;

    ads.push(ad);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<admarkt:ads xmlns:admarkt="${NS}">\n${ads.join("\n")}\n</admarkt:ads>\n`;

  return { xml, included: ads.length, skipped };
}
