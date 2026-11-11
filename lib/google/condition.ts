// Determines the Google Shopping `condition` attribute for a product —
// written to the variant metafield the Google & YouTube sales channel app
// reads (mm-google-shopping.condition). Google only accepts exactly "new",
// "used" or "refurbished" (lowercase) here — NEVER "refurbished" for this
// store: every physical device sold is a used, individually-inspected
// device, not something refurbished by Apple or an authorized refurbisher.
// Using "refurbished" when that isn't true violates Google's Accurate
// representation policy and risks a Merchant Center suspension.
//
// Accessories (screenprotectors, cables, adapters, cases) are sold as new,
// unused consumables (see shopify-theme/README.md §4) — those get "new".
// Everything else (every physical Apple device type, plus "Keyboard" —
// pre-owned branded keyboard accessories resold alongside devices, and
// "Product" — a handful of iMac listings mistagged with a generic type)
// is a used, previously-owned device and gets "used".

export type GoogleCondition = "new" | "used";

const NEW_ACCESSORY_TYPES = new Set(["Screenprotector", "Adapter", "Kabel", "Hoesje"]);

export function googleConditionForProductType(productType: string): GoogleCondition {
  return NEW_ACCESSORY_TYPES.has(productType) ? "new" : "used";
}
