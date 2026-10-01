// Shared types for the Playwright browser-test publisher. Kept separate from
// lib/marktplaats/types.ts (official API shapes) since this describes a
// generic "fill this form field" plan, not anything from the Marktplaats API.

export type BrowserFieldKind = "text" | "number" | "select" | "textarea" | "boolean";

/** One field to attempt to fill on the real Marktplaats listing form. */
export interface BrowserFieldPlanItem {
  /** Internal field key — same key as FIELD_LIBRARY / mkt.* metafield where applicable. */
  key: string;
  /** Dutch label(s) to try matching on the real page, most-likely first. */
  labels: string[];
  kind: BrowserFieldKind;
  value: string;
  /** For select/combobox fields: value plus known synonyms the real page might use. */
  valueSynonyms?: string[];
  required: boolean;
}

/** The full set of fields + non-field data (images) this test run should attempt. */
export interface BrowserTestPlan {
  shopifyProductId: string;
  productType: string;
  fields: BrowserFieldPlanItem[];
  imageUrls: string[];
  categoryLabel: string | null;
}

export type FieldFillStatus = "filled" | "selected" | "not_found" | "skipped" | "error";

export interface FieldFillResult {
  key: string;
  label: string;
  status: FieldFillStatus;
  detail?: string;
}

export interface BrowserTestResult {
  startedAt: string;
  allowSubmit: boolean;
  stoppedBeforeSubmit: boolean;
  fieldResults: FieldFillResult[];
  imagesUploaded: number;
  imagesFailed: number;
  warnings: string[];
  errors: string[];
  /** Best-effort — the browser window is left open; this is informational only. */
  pageUrl: string | null;
}
