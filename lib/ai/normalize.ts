// Central normalizers for AI-recognized product values. Every raw string the
// vision provider returns passes through here before it's shown to the user
// or written to a Shopify field — never write a provider's raw text directly.

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** "18 GB" / "18GB" / "18 Gb" -> "18GB" */
export function normalizeRam(raw: string | number | null): string | null {
  if (raw === null) return null;
  const match = String(raw).match(/(\d+(?:[.,]\d+)?)\s*([gG][bB]|[tT][bB])?/);
  if (!match) return null;
  const amount = match[1].replace(",", ".");
  const unit = (match[2] || "GB").toUpperCase();
  return `${amount}${unit}`;
}

/** "512 GB" / "512GB SSD" / "1 TB" -> "512GB" / "1TB" */
export function normalizeStorage(raw: string | number | null): string | null {
  if (raw === null) return null;
  const match = String(raw).match(/(\d+(?:[.,]\d+)?)\s*([gG][bB]|[tT][bB])/);
  if (!match) return null;
  const amount = match[1].replace(",", ".");
  const unit = match[2].toUpperCase();
  return `${amount}${unit}`;
}

/** "94 %" / "94 percent" / "94%" -> 94 (number, 0-100) */
export function normalizeBatteryHealth(raw: string | number | null): number | null {
  if (raw === null) return null;
  const match = String(raw).match(/(\d{1,3}(?:[.,]\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(",", "."));
  if (Number.isNaN(value) || value < 0 || value > 100) return null;
  return Math.round(value);
}

/** "M3 Pro" / "Apple M3 Pro" -> "Apple M3 Pro" */
export function normalizeChip(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = collapseWhitespace(raw);
  if (!cleaned) return null;
  return /^apple\b/i.test(cleaned) ? `Apple ${cleaned.replace(/^apple\s*/i, "")}` : `Apple ${cleaned}`;
}

/** Light-touch cleanup only — never invents or reformats beyond whitespace. */
export function normalizeModel(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = collapseWhitespace(raw);
  return cleaned || null;
}

/** Generic fallback for fields without a dedicated normalizer (color, screen_size, ...). */
export function normalizeText(raw: string | number | boolean | null): string | null {
  if (raw === null) return null;
  const cleaned = collapseWhitespace(String(raw));
  return cleaned || null;
}

/** "5" / "5.0"" -> "5-inch"-style values are left as-is; just trims. */
export function normalizeScreenSize(raw: string | number | null): string | null {
  return normalizeText(raw);
}

/** Whole-number counters (model_year, cycle_count). */
export function normalizeInteger(raw: string | number | null): number | null {
  if (raw === null) return null;
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  return parseInt(match[0], 10);
}

export type Normalizer = (raw: string | number | boolean | null) => string | number | null;

/** Per-field normalizer lookup used by the recognition service. */
export const FIELD_NORMALIZERS: Record<string, Normalizer> = {
  ram_gb: (v) => normalizeRam(v as string | number | null),
  storage_gb: (v) => normalizeStorage(v as string | number | null),
  battery_percentage: (v) => normalizeBatteryHealth(v as string | number | null),
  chip: (v) => normalizeChip(v as string | null),
  model: (v) => normalizeModel(v as string | null),
  screen_size: (v) => normalizeScreenSize(v as string | number | null),
  model_year: (v) => normalizeInteger(v as string | number | null),
  cycle_count: (v) => normalizeInteger(v as string | number | null),
};

export function normalizeField(key: string, raw: string | number | boolean | null): string | number | null {
  const normalizer = FIELD_NORMALIZERS[key] ?? normalizeText;
  return normalizer(raw);
}
