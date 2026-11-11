// Determines the product `condition` attribute shared by both the Google
// Shopping feed and the Meta (Facebook/Instagram) commerce catalog — both
// accept exactly the same three values ("new", "used", "refurbished"),
// lowercase. NEVER "refurbished" for this store: every physical device sold
// is a used, individually-inspected device, not something refurbished by
// Apple or an authorized refurbisher. Using "refurbished" when that isn't
// true violates both platforms' accurate-representation policies and risks
// a Merchant Center / Commerce Manager suspension.
//
// Accessories (screenprotectors, cables, adapters, cases) are sold as new,
// unused consumables (see shopify-theme/README.md §4) — those get "new".
// Everything else (every physical Apple device type, plus "Keyboard" —
// pre-owned branded keyboard accessories resold alongside devices, and
// "Product" — a handful of iMac listings mistagged with a generic type)
// is a used, previously-owned device and gets "used".

export type CatalogCondition = "new" | "used";

const NEW_ACCESSORY_TYPES = new Set(["Screenprotector", "Adapter", "Kabel", "Hoesje"]);

export function catalogConditionForProductType(productType: string): CatalogCondition {
  return NEW_ACCESSORY_TYPES.has(productType) ? "new" : "used";
}
