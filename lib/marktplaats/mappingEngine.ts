import { query } from "../db";
import { MarktplaatsCategoryAttribute } from "./types";
import { ProductTemplate } from "../templates/types";

export interface AttributeMappingResult {
  internalField: string;
  shopifyValue: string;
  marktplaatsAttributeKey: string | null;
  marktplaatsValue: string | number | null;
  status: "mapped" | "no_matching_attribute" | "value_not_allowed" | "not_writable" | "missing_value";
  note?: string;
}

/** Internal field -> Marktplaats attribute key, stored per L2 category (rule #22). */
export async function getAttributeMapping(l2CategoryId: string): Promise<Record<string, string>> {
  const rows = await query<{ internal_field: string; marktplaats_attribute_key: string | null }>(
    "SELECT internal_field, marktplaats_attribute_key FROM marktplaats_attribute_mapping WHERE marktplaats_l2_category_id = $1",
    [l2CategoryId]
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.marktplaats_attribute_key) map[row.internal_field] = row.marktplaats_attribute_key;
  }
  return map;
}

export async function setAttributeMapping(l2CategoryId: string, internalField: string, marktplaatsAttributeKey: string | null): Promise<void> {
  await query(
    `INSERT INTO marktplaats_attribute_mapping (marktplaats_l2_category_id, internal_field, marktplaats_attribute_key, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (marktplaats_l2_category_id, internal_field) DO UPDATE SET marktplaats_attribute_key = EXCLUDED.marktplaats_attribute_key, updated_at = now()`,
    [l2CategoryId, internalField, marktplaatsAttributeKey]
  );
}

function coerceValue(value: string, attr: MarktplaatsCategoryAttribute): { ok: boolean; coerced: string | number | null; reason?: string } {
  if (attr.type === "NUMBER" || attr.type === "DOUBLE") {
    const num = Number(value);
    if (Number.isNaN(num)) return { ok: false, coerced: null, reason: `"${value}" is geen geldig getal` };
    if (attr.minValue !== undefined && num < attr.minValue) return { ok: false, coerced: null, reason: `${num} is lager dan het minimum (${attr.minValue})` };
    if (attr.maxValue !== undefined && num > attr.maxValue) return { ok: false, coerced: null, reason: `${num} is hoger dan het maximum (${attr.maxValue})` };
    return { ok: true, coerced: num };
  }
  if (attr.type === "LIST") {
    const allowed = attr.options?.map((o) => o.value) ?? [];
    if (!allowed.includes(value)) {
      return { ok: false, coerced: null, reason: `"${value}" zit niet in de toegestane waarden: ${allowed.join(", ")}` };
    }
    return { ok: true, coerced: value };
  }
  // STRING / OBJECT
  if (attr.maxAllowedLength && value.length > attr.maxAllowedLength) {
    return { ok: false, coerced: null, reason: `waarde is langer dan toegestaan (${attr.maxAllowedLength})` };
  }
  return { ok: true, coerced: value };
}

/**
 * Maps a product's structured fields onto the live/mocked category
 * attributes for its Marktplaats leaf category. Category-aware: never uses
 * a global mapping blindly (rule #22). Never invents an attribute or forces
 * a disallowed value (rule #23/#24) — anything that doesn't fit comes back
 * with a clear status instead.
 */
export async function mapProductToAttributes(
  template: ProductTemplate,
  data: Record<string, string>,
  l2CategoryId: string,
  categoryAttributes: MarktplaatsCategoryAttribute[]
): Promise<AttributeMappingResult[]> {
  const fieldMapping = await getAttributeMapping(l2CategoryId);
  const attributesByKey = new Map(categoryAttributes.map((a) => [a.key, a]));

  const results: AttributeMappingResult[] = [];

  for (const internalField of template.marktplaatsAttributes) {
    const shopifyValue = data[internalField];
    if (!shopifyValue || shopifyValue.trim().length === 0) {
      results.push({ internalField, shopifyValue: "", marktplaatsAttributeKey: null, marktplaatsValue: null, status: "missing_value" });
      continue;
    }

    const mpKey = fieldMapping[internalField];
    if (!mpKey) {
      results.push({
        internalField,
        shopifyValue,
        marktplaatsAttributeKey: null,
        marktplaatsValue: null,
        status: "no_matching_attribute",
        note: "Geen mapping ingesteld voor dit veld op deze categorie — wordt (indien relevant) alleen in titel/beschrijving gebruikt.",
      });
      continue;
    }

    const attr = attributesByKey.get(mpKey);
    if (!attr) {
      results.push({
        internalField,
        shopifyValue,
        marktplaatsAttributeKey: mpKey,
        marktplaatsValue: null,
        status: "no_matching_attribute",
        note: `Attribuut "${mpKey}" bestaat niet (meer) in deze Marktplaats-categorie.`,
      });
      continue;
    }

    if (!attr.writable) {
      results.push({ internalField, shopifyValue, marktplaatsAttributeKey: mpKey, marktplaatsValue: null, status: "not_writable", note: "Attribuut is niet writable volgens de Marktplaats API." });
      continue;
    }

    const coerced = coerceValue(shopifyValue, attr);
    if (!coerced.ok) {
      results.push({ internalField, shopifyValue, marktplaatsAttributeKey: mpKey, marktplaatsValue: null, status: "value_not_allowed", note: coerced.reason });
      continue;
    }

    results.push({ internalField, shopifyValue, marktplaatsAttributeKey: mpKey, marktplaatsValue: coerced.coerced, status: "mapped" });
  }

  return results;
}
