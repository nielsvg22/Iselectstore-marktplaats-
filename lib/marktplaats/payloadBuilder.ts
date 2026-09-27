import { CategoryMapping } from "./categoryService";
import { AttributeMappingResult } from "./mappingEngine";
import { MarktplaatsAdvertisementPayload } from "./types";

export function buildMarktplaatsPayload(params: {
  categoryMapping: CategoryMapping;
  title: string;
  description: string;
  price: number;
  attributeResults: AttributeMappingResult[];
  imageUrls: string[];
  postcode?: string;
  cityName?: string;
}): MarktplaatsAdvertisementPayload & { imageUrls: string[] } {
  const { categoryMapping, title, description, price, attributeResults, imageUrls, postcode, cityName } = params;

  const attributes = attributeResults
    .filter((r) => r.status === "mapped" && r.marktplaatsAttributeKey && r.marktplaatsValue !== null)
    .map((r) => ({ key: r.marktplaatsAttributeKey as string, value: r.marktplaatsValue as string | number }));

  return {
    categoryId: Number(categoryMapping.l2CategoryId) || (categoryMapping.l2CategoryId as unknown as number),
    priceModel: { modelType: "fixed", askingPrice: price },
    location: postcode ? { postcode } : { cityName: cityName ?? "" },
    translations: [{ title, description, locale: "nl-NL" }],
    attributes,
    // imageUrls is not part of the official advertisement payload itself —
    // images are uploaded separately via /v2/advertisements/{itemId}/images
    // after creation — kept here only for the raw-payload preview screen.
    imageUrls,
  };
}

/** Strips anything that must never be shown in a "raw payload" preview. */
export function redactForPreview<T extends Record<string, unknown>>(payload: T): T {
  const clone = { ...payload };
  delete (clone as Record<string, unknown>).accessToken;
  delete (clone as Record<string, unknown>).client_secret;
  delete (clone as Record<string, unknown>).refresh_token;
  return clone;
}
