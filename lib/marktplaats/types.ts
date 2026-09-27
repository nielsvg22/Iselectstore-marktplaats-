// Shapes mirrored from the OFFICIAL Marktplaats API v2 docs:
// https://api.marktplaats.nl/docs/v2/category-attributes.html
// https://api.marktplaats.nl/docs/v2/category.html
// https://api.marktplaats.nl/docs/v2/advertisement.html
// Field names here are as documented — never invented (rule #23).

export type MarktplaatsAttributeType = "STRING" | "LIST" | "NUMBER" | "DOUBLE" | "OBJECT";

export interface MarktplaatsAttributeOption {
  value: string;
  labels?: Record<string, string>;
}

export interface MarktplaatsCategoryAttribute {
  key: string;
  labels: Record<string, string>;
  type: MarktplaatsAttributeType;
  options?: MarktplaatsAttributeOption[];
  minValue?: number;
  maxValue?: number;
  minAllowedLength?: number;
  maxAllowedLength?: number;
  units?: Record<string, string>;
  mandatory: boolean;
  searchable: boolean;
  writable: boolean;
  updateable: boolean;
}

export interface MarktplaatsCategory {
  categoryId: number;
  labels: Record<string, string>;
  status: "open" | "closed";
}

export interface MarktplaatsAdvertisementAttributeValue {
  key: string;
  value: string | number;
}

export interface MarktplaatsAdvertisementPayload {
  categoryId: number;
  priceModel: { modelType: "fixed" | "on_request" | "min_bid" | "free" | "reserved" | "see_description"; askingPrice?: number };
  location: { postcode?: string; cityName?: string };
  translations: { title: string; description: string; locale: string }[];
  attributes?: MarktplaatsAdvertisementAttributeValue[];
  reserved?: boolean;
}

export interface MarktplaatsAdvertisement extends MarktplaatsAdvertisementPayload {
  itemId: string;
  status?: string;
}
