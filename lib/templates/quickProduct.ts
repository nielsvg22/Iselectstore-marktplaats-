// Pure quick-create/quick-edit logic shared by the Admin UI extension (live
// validation + previews while typing) and the backend endpoints (authoritative
// re-validation before anything is written to Shopify). Uses the existing
// template registry and title generators — never a second copy of either.
import { ProductTemplate, ShopifyProductType, FieldKind } from "./types";
import { getTemplate, listProductTypes } from "./registry";
import {
  generateShopifyTitle,
  generateMarktplaatsTitle,
} from "../marktplaats/titleGenerator";

export type QuickProductValues = Record<string, string>;

export interface QuickProductIssue {
  key: string;
  message: string;
}

export interface QuickProductValidation {
  ok: boolean;
  issues: QuickProductIssue[];
  /** Cleaned values: defaults applied, trimmed, booleans/numbers normalized,
   * unknown keys dropped. Only this map may ever be written to Shopify. */
  values: QuickProductValues;
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

/** Returns the template's values with defaults filled in for empty fields,
 * strings trimmed, numbers normalized (comma -> dot) and booleans reduced to
 * "true"/"false". Keys not part of the template are dropped. */
export function applyTemplateDefaults(
  template: ProductTemplate,
  data: Record<string, unknown>
): QuickProductValues {
  const out: QuickProductValues = {};
  for (const field of template.fields) {
    const raw = data[field.key];
    if (isEmpty(raw)) {
      if (field.default !== undefined) out[field.key] = field.default;
      continue;
    }
    let value = String(raw).trim();
    if (field.kind === "number") value = value.replace(",", ".");
    if (field.kind === "boolean") {
      const lowered = value.toLowerCase();
      if (["true", "1", "yes", "ja"].includes(lowered)) value = "true";
      else if (["false", "0", "no", "nee"].includes(lowered)) value = "false";
    }
    out[field.key] = value;
  }
  return out;
}

function validateValue(
  key: string,
  kind: FieldKind,
  required: boolean,
  options: string[] | undefined,
  value: string | undefined
): QuickProductIssue | null {
  const label = key; // replaced by caller with the field label
  if (value === undefined || value === "") {
    if (required) return { key, message: `${label} is verplicht.` };
    return null;
  }
  if (kind === "number" && !NUMBER_RE.test(value)) {
    return { key, message: `${label} moet een getal zijn.` };
  }
  if (kind === "select" && options && !options.includes(value)) {
    return { key, message: `${label} moet een van de opties zijn.` };
  }
  if (kind === "boolean" && !["true", "false"].includes(value)) {
    return { key, message: `${label} moet waar of onwaar zijn.` };
  }
  return null;
}

/** Validates incoming data for a product type. Unknown product types, missing
 * required fields, bad numbers and values outside a select's options are all
 * reported per field so the UI can highlight exactly what to fix. */
export function validateQuickProductData(
  productType: string,
  data: Record<string, unknown>
): QuickProductValidation {
  const issues: QuickProductIssue[] = [];
  const template = getTemplate(productType);
  if (!template) {
    return {
      ok: false,
      issues: [
        { key: "productType", message: "Kies een geldig producttype." },
      ],
      values: {},
    };
  }

  const values = applyTemplateDefaults(template, data);
  for (const field of template.fields) {
    const issue = validateValue(
      field.key,
      field.kind,
      field.required,
      field.options,
      values[field.key]
    );
    if (issue) {
      issues.push({ key: field.key, message: issue.message.replace(issue.key, field.label) });
    }
  }

  return { ok: issues.length === 0, issues, values };
}

export interface QuickProductTitles {
  shopifyTitle: string;
  marktplaatsTitle: string;
}

/** Live previews for the form: the exact titles the generators produce for
 * the current values (same code the Marktplaats publish flow uses). */
export function buildQuickProductTitles(
  productType: string,
  data: Record<string, unknown>
): QuickProductTitles {
  const template = getTemplate(productType);
  if (!template) return { shopifyTitle: "", marktplaatsTitle: "" };
  const values = applyTemplateDefaults(template, data);
  const shopifyTitle = generateShopifyTitle(template, values);
  const marktplaatsTitle = generateMarktplaatsTitle(template, values, shopifyTitle);
  return { shopifyTitle, marktplaatsTitle };
}

export function isKnownProductType(productType: string): boolean {
  return listProductTypes().includes(productType as ShopifyProductType);
}
