// Pure logica achter /admin/quick-create: beginwaarden, verplichte-velden-
// telling en het omzetten van AI-herkende waarden naar formulierwaarden.
// Bewust .ts (geen JSX) zodat het unit-testbaar is; het formulier zelf is de
// clientcomponent hieronder.
import { getTemplate } from "@/lib/templates/registry";
import { applyTemplateDefaults } from "@/lib/templates/quickProduct";
import type { FieldDef, ProductTemplate } from "@/lib/templates/types";

export interface AppliedFieldValue {
  key: string;
  value: string | number;
}

/** Beginwaarden voor een producttype — dezelfde defaults als de extension. */
export function initialValuesFor(productType: string): Record<string, string> {
  const template = getTemplate(productType);
  return template ? applyTemplateDefaults(template, {}) : {};
}

/** Aantal nog ontbrekende verplichte velden (met dezelfde default-toepassing
 * als de server-validatie, zodat de teller klopt met wat "aanmaken" zegt). */
export function missingRequiredCount(
  template: ProductTemplate | undefined,
  values: Record<string, unknown>
): number {
  if (!template) return 0;
  const withDefaults = applyTemplateDefaults(template, values);
  return template.fields.filter(
    (field) => field.required && !String(withDefaults[field.key] ?? "").trim()
  ).length;
}

/** Zet één AI-waarde om naar de waarde die het formulierveld verwacht.
 * Getalvelden krijgen alleen het numerieke deel ("18GB" -> "18", "94%" ->
 * "94"), selectvelden alleen een exacte optie (ook case-insensitief).
 * Retourneert null als de waarde niet in het veld past — dan wordt het veld
 * bewust NIET gevuld zodat de gebruiker het handmatig controleert. */
export function aiValueForField(field: FieldDef, raw: string | number): string | null {
  const value = String(raw).trim();
  if (!value) return null;
  if (field.kind === "number") {
    const match = value.replace(",", ".").match(/-?\d+(\.\d+)?/);
    return match ? match[0] : null;
  }
  if (field.kind === "select") {
    const options = field.options ?? [];
    const exact = options.find((o) => o === value);
    if (exact) return exact;
    const folded = options.find((o) => o.toLowerCase() === value.toLowerCase());
    return folded ?? null;
  }
  if (field.kind === "boolean") {
    const lowered = value.toLowerCase();
    if (["true", "1", "yes", "ja"].includes(lowered)) return "true";
    if (["false", "0", "no", "nee"].includes(lowered)) return "false";
    return null;
  }
  return value;
}

/** Past AI-herkende velden toe op de formulierwaarden. Onbekende keys, velden
 * die niet bij het huidige template horen en waarden die niet passen worden
 * overgeslagen; appliedKeys bevat de sleutels die daadwerkelijk zijn gezet. */
export function aiFieldsToValues(
  template: ProductTemplate | undefined,
  values: Record<string, string>,
  fields: AppliedFieldValue[]
): { values: Record<string, string>; appliedKeys: string[] } {
  const next = { ...values };
  const appliedKeys: string[] = [];
  if (!template) return { values: next, appliedKeys };
  for (const field of fields) {
    const def = template.fields.find((f) => f.key === field.key);
    if (!def) continue;
    const coerced = aiValueForField(def, field.value);
    if (coerced === null) continue;
    next[field.key] = coerced;
    appliedKeys.push(field.key);
  }
  return { values: next, appliedKeys };
}
