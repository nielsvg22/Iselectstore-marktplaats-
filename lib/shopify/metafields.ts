// Central mapping between template fields (lib/templates) and Shopify
// metafields. Pure module — no I/O — so both the backend write path and the
// Admin UI extension bundle can import it without duplication.
//
// Two namespaces are involved:
// - `mkt` (resolved app-reserved namespace): the app's structured source of
//   truth, read by the Marktplaats orchestrator, AI panel and admin panel.
// - `custom`: read by the storefront theme's product specs table. A small set
//   of keys is mirrored there on every write so products created through the
//   quick-create extension render identically to manually created ones.
import { FIELD_LIBRARY, FieldDef, ProductTemplate } from "../templates/types";

/** Resolved app-reserved namespace: $app:mkt -> app--{appId}--mkt. Must match
 * the namespace used when creating the metafield definitions (see
 * MARKTPLAATS_INTEGRATION.md). */
export const MKT_NAMESPACE = "app--428689915905--mkt";

/** Namespace the storefront theme reads (product.metafields.custom.*). */
export const STOREFRONT_MIRROR_NAMESPACE = "custom";

/** Template keys the theme's product specs table depends on. */
export const STOREFRONT_MIRROR_KEYS: readonly string[] = [
  "storage_gb",
  "battery_percentage",
  "condition",
  "warranty_months",
];

/** Price fields are decimal in the live metafield definitions (number_decimal). */
const DECIMAL_FIELDS = new Set(["sell_price", "new_price"]);

export interface MetafieldWrite {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

/** Shopify metafield type for a template field, matching the definitions
 * already created for the `mkt` namespace. Every FIELD_LIBRARY key must
 * resolve to the type its live definition uses (covered by tests). */
export function metafieldTypeFor(key: string): string {
  const def: FieldDef | undefined = FIELD_LIBRARY[key];
  if (!def) return "single_line_text_field";
  if (DECIMAL_FIELDS.has(key)) return "number_decimal";
  switch (def.kind) {
    case "number":
      return "number_integer";
    case "textarea":
      return "multi_line_text_field";
    case "boolean":
      return "boolean";
    default:
      return "single_line_text_field";
  }
}

/** Builds the full set of metafield writes (mkt + storefront mirror) for a
 * validated template data map. Empty values are skipped — they never existed
 * on manually created products either. */
export function metafieldsForTemplateData(
  template: ProductTemplate,
  data: Record<string, string>
): MetafieldWrite[] {
  const writes: MetafieldWrite[] = [];
  const seen = new Set<string>();
  for (const field of template.fields) {
    const raw = data[field.key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value.length === 0 || seen.has(field.key)) continue;
    seen.add(field.key);
    const type = metafieldTypeFor(field.key);
    writes.push({ namespace: MKT_NAMESPACE, key: field.key, value, type });
    if (STOREFRONT_MIRROR_KEYS.includes(field.key)) {
      writes.push({
        namespace: STOREFRONT_MIRROR_NAMESPACE,
        key: field.key,
        value,
        type,
      });
    }
  }
  return writes;
}
