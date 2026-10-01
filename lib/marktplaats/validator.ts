import { ProductTemplate } from "../templates/types";
import { AttributeMappingResult } from "./mappingEngine";
import { CategoryMapping, isMappingVerified } from "./categoryService";

export type CheckStatus = "ok" | "warning" | "error";

export interface ValidationCheck {
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface ValidationResult {
  checks: ValidationCheck[];
  publishable: boolean;
}

// Geverifieerd op het echte Marktplaats-formulier: het titelveld telt "N/60".
const MARKTPLAATS_TITLE_MAX_LENGTH = 60;
const MARKTPLAATS_DESCRIPTION_MAX_LENGTH = 5000; // Verify against current docs before going live.

export function runPreflightValidation(params: {
  template: ProductTemplate;
  data: Record<string, string>;
  categoryMapping: CategoryMapping | null;
  attributeResults: AttributeMappingResult[];
  title: string;
  description: string;
  imageCount: number;
}): ValidationResult {
  const { template, data, categoryMapping, attributeResults, title, description, imageCount } = params;
  const checks: ValidationCheck[] = [];

  if (!categoryMapping) {
    checks.push({ label: "Categorie", status: "error", detail: "Geen Marktplaats-categorie mapping gevonden voor dit producttype." });
  } else if (!isMappingVerified(categoryMapping)) {
    checks.push({ label: "Categorie", status: "warning", detail: `Mapping naar "${categoryMapping.l2CategoryName}" is nog niet geverifieerd via de live Marktplaats API.` });
  } else {
    checks.push({ label: "Categorie", status: "ok", detail: categoryMapping.l2CategoryName });
  }

  const missingRequired = template.fields.filter((f) => f.required && (!data[f.key] || data[f.key].trim().length === 0));
  if (missingRequired.length > 0) {
    checks.push({ label: "Verplichte velden", status: "error", detail: `Ontbreekt: ${missingRequired.map((f) => f.label).join(", ")}` });
  } else {
    checks.push({ label: "Verplichte velden", status: "ok", detail: "Compleet" });
  }

  for (const result of attributeResults) {
    if (result.status === "mapped") {
      checks.push({ label: result.internalField, status: "ok", detail: `${result.shopifyValue} → ${result.marktplaatsAttributeKey}` });
    } else if (result.status === "no_matching_attribute" || result.status === "not_writable") {
      checks.push({ label: result.internalField, status: "warning", detail: result.note ?? "Geen officieel writable attribuut — wordt in titel/beschrijving gebruikt." });
    } else if (result.status === "value_not_allowed") {
      checks.push({ label: result.internalField, status: "error", detail: result.note });
    }
    // missing_value on an optional field is not reported as a check line
  }

  if (title.length === 0) {
    checks.push({ label: "Titel", status: "error", detail: "Titel is leeg." });
  } else if (title.length > MARKTPLAATS_TITLE_MAX_LENGTH) {
    checks.push({ label: "Titel", status: "error", detail: `Titel is ${title.length} tekens, maximum is ${MARKTPLAATS_TITLE_MAX_LENGTH}.` });
  } else {
    checks.push({ label: "Titel", status: "ok", detail: title });
  }

  if (description.length === 0) {
    checks.push({ label: "Beschrijving", status: "error", detail: "Beschrijving is leeg." });
  } else if (description.length > MARKTPLAATS_DESCRIPTION_MAX_LENGTH) {
    checks.push({ label: "Beschrijving", status: "error", detail: `Beschrijving is ${description.length} tekens, maximum is ${MARKTPLAATS_DESCRIPTION_MAX_LENGTH}.` });
  } else {
    checks.push({ label: "Beschrijving", status: "ok" });
  }

  if (imageCount === 0) {
    checks.push({ label: "Foto's", status: "error", detail: "Geen productfoto's gevonden op Shopify." });
  } else {
    checks.push({ label: "Foto's", status: "ok", detail: `${imageCount} foto('s)` });
  }

  const publishable = checks.every((c) => c.status !== "error");
  return { checks, publishable };
}
