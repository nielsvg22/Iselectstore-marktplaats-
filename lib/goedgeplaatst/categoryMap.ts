/**
 * GoedGeplaatst categoryId per Shopify product type, so the GoedGeplaatst
 * section on a product page can pre-select a category automatically instead
 * of making the user pick one by hand every time — confirmed live via a
 * real POST /categories/ call against this account's own GoedGeplaatst API
 * key (categoryId is GoedGeplaatst's OWN internal id space, NOT the same as
 * lib/marktplaats/feedBuilder.ts's ADMARKT_CATEGORY_MAP, which is a
 * different system's category tree — re-verify here if GoedGeplaatst
 * restructures their categories or a new product type is added).
 *
 * "Apple Watch" has no Apple-specific category on GoedGeplaatst (unlike
 * iPhone/iPad/MacBook/iMac) — 2455 "Smartwatches" is the closest real match,
 * same situation as ADMARKT_CATEGORY_MAP's own fallback for that product.
 */
export const GOEDGEPLAATST_CATEGORY_MAP: Record<string, number> = {
  iPhone: 1737, // Mobiele telefoons | Apple iPhone
  iPad: 2110, // Apple iPads
  MacBook: 351, // Apple Macbooks
  iMac: 350, // Apple Desktops
  "Mac mini": 350, // Apple Desktops
  "Apple Watch": 2455, // Smartwatches
};

export function resolveGoedgeplaatstCategoryId(productType: string): number | null {
  return GOEDGEPLAATST_CATEGORY_MAP[productType] ?? null;
}
