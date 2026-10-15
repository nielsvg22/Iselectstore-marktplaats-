// Shapes mirrored from the GoedGeplaatst REST v1 docs (docs.goedgeplaatst.nl)
// as handed over for this task on 2026-10-12. Field names here are as
// documented — never invented. Re-check docs.goedgeplaatst.nl before relying
// on these for anything beyond the "concept"-only flow this feature builds.

/** Every GoedGeplaatst endpoint answers with this envelope — never trust HTTP status alone. */
export interface GoedgeplaatstEnvelope<T> {
  result: boolean;
  errors: GoedgeplaatstApiErrorItem[];
  data: T;
}

export interface GoedgeplaatstApiErrorItem {
  code?: string | number;
  message?: string;
  field?: string;
  [key: string]: unknown;
}

export type GoedgeplaatstAdStatus = "concept" | "active" | "archive";
export type GoedgeplaatstAdType = "supply" | "demand";
export type GoedgeplaatstPriceModel = "fixed" | "bidding" | "see description" | "reserved";

export interface GoedgeplaatstAttributeValue {
  key: string;
  value: string | number;
  label?: string;
}

export interface GoedgeplaatstAttributeGroup {
  portal: string;
  locale: string;
  values: GoedgeplaatstAttributeValue[];
}

export interface GoedgeplaatstPriceInput {
  model: GoedgeplaatstPriceModel;
  /** Cents. Required for fixed/bidding. */
  price?: number;
  /** Cents. Only for bidding. */
  minimumBid?: number;
  /** Cents. */
  shippingCosts?: number;
  /**
   * Doc inconsistency: the WRITE field is `retail`, the READ field on the
   * same object comes back as `retailPrice` (see GoedgeplaatstAd below).
   * Never read `retail` back from a response.
   */
  retail?: number;
}

export interface GoedgeplaatstSettingsInput {
  portal: string;
  showcontact?: boolean;
  autoreplace?: boolean;
  video?: string;
}

/** POST /ads/ request body. */
export interface GoedgeplaatstCreateAdInput {
  userId: number;
  status: GoedgeplaatstAdStatus;
  /** Required for partner accounts — we send the Shopify product id as a numeric test value (see mapper.ts). */
  externalAdId?: number;
  type: GoedgeplaatstAdType;
  title: string;
  imagetext?: string;
  description: string;
  categoryId: number;
  attributes: GoedgeplaatstAttributeGroup[];
  price: GoedgeplaatstPriceInput;
  url?: string;
  contactId?: number;
  folderId?: number;
  settings?: GoedgeplaatstSettingsInput[];
  misc?: { licensePlate?: string };
}

/** What GET/POST /ads/ return for one ad — includes read-only fields never sent on create. */
export interface GoedgeplaatstAd {
  adId: number;
  userId: number;
  externalAdId?: number;
  status: GoedgeplaatstAdStatus;
  type: GoedgeplaatstAdType;
  title: string;
  imagetext?: string;
  description: string;
  categoryId: number;
  categoryDescription?: string;
  attributes?: GoedgeplaatstAttributeGroup[];
  /** Read-only response field for the write field `price.retail` — see GoedgeplaatstPriceInput. */
  prices?: { model: GoedgeplaatstPriceModel; price?: number; minimumBid?: number; shippingCosts?: number; retailPrice?: number };
  images?: { adImageId?: number; url?: string; thumbnail?: string }[];
  portals?: Record<string, unknown>;
  source?: string;
  groupId?: number;
  groupDescription?: string;
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

export interface GoedgeplaatstImageInput {
  counter?: number;
  image: { url?: string; path?: string };
  thumbnail?: string;
}

/** PUT /images/<adId> request body — ADDS images, never replaces (see config.ts header comment). */
export interface GoedgeplaatstAddImagesInput {
  images: GoedgeplaatstImageInput[];
  autoupdate?: boolean;
}

export interface GoedgeplaatstAddImagesResult {
  adId: number;
  images: { adImageId?: number; url?: string; thumbnail?: string }[];
}

export interface GoedgeplaatstCategory {
  categoryId: number;
  descriptions: { locale: string; description: string }[];
  status?: string;
  conversiontree?: Record<string, unknown>;
}

export interface GoedgeplaatstCategoryGroup {
  groupId?: number;
  groupDescription?: string;
  categories: GoedgeplaatstCategory[];
}

export interface GoedgeplaatstAttributeDefinition {
  key: string;
  label: string;
  type: string;
  values?: { value: string; label?: string }[];
  mandatory: boolean;
  writable: boolean;
  updatable: boolean;
  searchable?: boolean;
  minimum?: number;
  maximum?: number;
  unit?: string;
}

export interface GoedgeplaatstPortalAttributes {
  portal: string;
  locale: string;
  attributes: GoedgeplaatstAttributeDefinition[];
}

export interface GoedgeplaatstCategoryAttributes {
  categoryId: number;
  attributes: GoedgeplaatstPortalAttributes[];
}

export interface GoedgeplaatstUser {
  userId: number;
  [key: string]: unknown;
}

export interface GoedgeplaatstPortalPublishState {
  portal: string;
  publish: { pending?: boolean; active?: boolean; online?: boolean; error?: string | null };
}

export interface GoedgeplaatstStatus {
  adId: number;
  userId: number;
  portals: GoedgeplaatstPortalPublishState[];
}

/** DSA/GPSR attribute keys Marktplaats has required since 1 Feb 2025 for authorised business sellers. */
export const GPSR_MANUFACTURER_ATTRIBUTE_KEYS = ["manufacturerTradename", "manufacturerAddress", "manufacturerEmail"] as const;
