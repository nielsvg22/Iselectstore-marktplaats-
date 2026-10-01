/**
 * Selector plans for the real Marktplaats placement form (www.marktplaats.nl/plaats).
 *
 * Strategy: always try the *robust* candidates first (accessible label, role +
 * name, placeholder, data-testid) and only fall back to CSS/XPath when nothing
 * else matches. Every candidate list is ordered, so the publisher can report
 * exactly which strategy worked and which field could not be found.
 *
 * Patterns are either a literal string or a regex literal ("/…/flags").
 * Nothing here hardcodes a *single* CSS path as the only option.
 */

export type SelectorStrategy = "label" | "role" | "placeholder" | "testid" | "css" | "xpath";
export type LocatorRole = "textbox" | "searchbox" | "combobox" | "spinbutton" | "button" | "link";

export interface SelectorCandidate {
  strategy: SelectorStrategy;
  /** Required for strategy "role". */
  role?: LocatorRole;
  /** Literal text or "/regex/flags". For "testid" always the literal test id. */
  pattern: string;
  exact?: boolean;
  /** Human note shown in debug output when this candidate was the one that matched. */
  note?: string;
}

export type FormFieldKind = "text" | "textarea" | "select" | "number" | "file";

/**
 * Field-specific alias list — the labels Marktplaats itself uses (NL) plus our
 * own template labels, so a field is found even when the attribute is
 * phrased differently on the live page.
 */
export const FIELD_LABEL_ALIASES: Record<string, string[]> = {
  model: ["Model", "Type", "Uitvoering"],
  storage_gb: ["Opslagcapaciteit", "Opslag", "Geheugen", "Capaciteit", "Opslagcapaciteit (GB)"],
  color: ["Kleur"],
  condition: ["Conditie", "Staat", "Productstaat"],
  battery_percentage: ["Batterijconditie", "Batterijpercentage", "Batterij", "Accuconditie", "Batterijstaat"],
  manufacturer_name: ["Merk", "Merknaam", "Fabrikant", "Handelsnaam fabrikant", "Merk van het product"],
  warranty_months: ["Garantie", "Garantie (maanden)", "Garantieperiode"],
  ram_gb: ["RAM", "Werkgeheugen", "RAM (GB)"],
  chip: ["Chip", "Processor", "SoC"],
  watch_case_size: ["Kastmaat", "Diameter", "Kastmaat (mm)"],
  watch_series: ["Serie", "Collectie"],
  watch_material: ["Materiaal"],
  watch_band: ["Bandje", "Band"],
  watch_connectivity: ["Connectiviteit", "Versie"],
  screen_size: ["Schermformaat", "Schermgrootte", "Display"],
  model_year: ["Modeljaar", "Bouwjaar"],
  cycle_count: ["Laadcycli", "Aantal laadcycli"],
  subscription: ["Abonnement"],
  simlock: ["Simlock"],
  sim_type: ["SIM", "Simkaart"],
  wifi_cellular: ["Connectiviteit", "Wi-Fi / Cellular"],
  keyboard_layout: ["Toetsenbordindeling", "Toetsenbord"],
  accessories: ["Accessoires", "Meegeleverd"],
  box_included: ["Doos aanwezig", "Originele doos"],
};

function label(...patterns: string[]): SelectorCandidate[] {
  return patterns.map((pattern) => ({ strategy: "label" as const, pattern }));
}

/**
 * Our Shopify option text vs. what the real Marktplaats option list is likely
 * to call the same thing. Only used as an *extra* candidate after the value
 * itself and the resolved Marktplaats attribute option label — never as a
 * replacement for either, so this can never override the actual mapping.
 */
export const FIELD_VALUE_SYNONYMS: Record<string, string[]> = {
  // Real condition list (Telecommunicatie > Mobiele telefoons): Nieuw,
  // Refurbished, Zo goed als nieuw, Gebruikt, Niet werkend.
  "Als nieuw": ["Zo goed als nieuw", "Nieuw", "Refurbished"],
  "Zeer nette staat": ["Zo goed als nieuw", "Gebruikt"],
  "Nette staat": ["Gebruikt", "Zo goed als nieuw"],
  "Zichtbare gebruikssporen": ["Gebruikt", "Niet werkend"],
  "Niet werkend": ["Niet werkend"],
  // Real colour list has no "Space gray" — closest is Grijs, then Zilver.
  "Space gray": ["Grijs", "Zilver"],
  "Space Grey": ["Grijs", "Zilver"],
  "Space Gray": ["Grijs", "Zilver"],
  Goud: ["Goud"],
  Zilver: ["Zilver"],
};

/** Candidate display values for one select field, most-likely first, de-duped. */
export function selectValueCandidates(rawValue: string, optionLabel: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (v?: string | null) => {
    if (!v) return;
    const trimmed = v.trim();
    if (trimmed.length === 0 || seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  };
  push(rawValue);
  push(optionLabel);
  for (const syn of FIELD_VALUE_SYNONYMS[rawValue] ?? []) push(syn);
  return out;
}

function role(roleName: LocatorRole, ...patterns: string[]): SelectorCandidate[] {
  return patterns.map((pattern) => ({ strategy: "role" as const, role: roleName, pattern }));
}

function placeholder(...patterns: string[]): SelectorCandidate[] {
  return patterns.map((pattern) => ({ strategy: "placeholder" as const, pattern }));
}

function css(value: string, note?: string): SelectorCandidate {
  return { strategy: "css", pattern: value, note };
}

function xpath(value: string, note?: string): SelectorCandidate {
  return { strategy: "xpath", pattern: value, note };
}

function testid(...values: string[]): SelectorCandidate[] {
  return values.map((value) => ({ strategy: "testid" as const, pattern: value }));
}

/** Core (non-attribute) fields of the Marktplaats form. */
export const CORE_FIELD_SELECTORS: Record<string, { kind: FormFieldKind; candidates: SelectorCandidate[] }> = {
  // WIZARD STAP 1 ("Wat wil je verkopen?") — alleen dit veld bestaat daar.
  titleStep1: {
    kind: "text",
    candidates: [
      ...label("/vul een titel in/i"),
      ...role("textbox", "/vul een titel in/i"),
      ...testid("TextField-vulEenTitelIn"),
      css("#TextField-vulEenTitelIn", "CSS: #TextField-vulEenTitelIn"),
      css('input[name="keywords"]', 'CSS: input[name="keywords"]'),
      xpath("//*[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'vuleentitelin')]", "XPath fallback titel stap 1"),
    ],
  },
  // WIZARD STAP 2 ("Details") — het echte advertentieveld.
  title: {
    kind: "text",
    candidates: [
      ...label("/^titel(\\s*\\(.*\\))?\\s*:?$/i"),
      ...role("textbox", "/^titel/i"),
      ...testid("test-title_nl-NL", "title_nl-NL", "ad-title"),
      css("#title_nl-NL", "CSS: #title_nl-NL"),
      css('input[name="title_nl-NL"]', 'CSS: input[name="title_nl-NL"]'),
      ...placeholder("/^titel/i"),
      css('input[name*="title" i]', "CSS fallback: input[name*=title]"),
      xpath("//input[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'title')]", "XPath fallback titel"),
    ],
  },
  description: {
    kind: "textarea",
    candidates: [
      ...label("/^(beschrijving|omschrijving|beschrijf|vertel meer|details)/i"),
      ...role("textbox", "/^(beschrijving|omschrijving|beschrijf|vertel meer)/i"),
      ...testid("text-editor-input_nl-NL", "ad-description", "description-input", "description"),
      css('[data-testid^="text-editor-input"]', "CSS: rijke tekst-editor"),
      ...placeholder("/beschrijving|omschrijving|vertel/i"),
      css('div[contenteditable="true"]', "CSS fallback: contenteditable"),
      css("textarea", "CSS fallback: eerste textarea"),
      xpath("//textarea[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'description')]", "XPath fallback beschrijving"),
    ],
  },
  price: {
    kind: "number",
    candidates: [
      // Anchor the whole label: an unanchored /^(prijs|…)/ also matches the
      // "Prijstype" dropdown that sits directly above the amount field.
      ...label("/^(vraagprijs|je vraagprijs|prijs|bedrag)(\\s*\\(.*\\))?\\s*:?$/i"),
      ...role("textbox", "/^(vraagprijs|je vraagprijs|prijs|bedrag)(\\s*\\(.*\\))?\\s*:?$/i"),
      css('input[name="price.value"]', 'CSS: input[name="price.value"]'),
      css('input[id="price.value"]', 'CSS: #price.value'),
      ...role("spinbutton", "/prijs|bedrag/i"),
      ...testid("ad-price", "price-input", "price"),
      ...placeholder("/^0,00$|prijs|bedrag/i"),
      css('input[name*="price" i]', "CSS fallback: input[name*=price]"),
      xpath("//input[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'price')]", "XPath fallback prijs"),
    ],
  },
  category: {
    kind: "select",
    candidates: [
      css("#cat_sel_1", "CSS: #cat_sel_1 (rubriek)"),
      css("#cat_sel_2", "CSS: #cat_sel_2 (subrubriek)"),
      css("#cat_sel_3", "CSS: #cat_sel_3 (type)"),
      ...role("combobox", "/rubriek|categorie|wat verkoop|wat zoek/i"),
      ...placeholder("/rubriek|categorie|wat verkoop|welke categorie|kies een categorie/i"),
      ...testid("category-search", "rubriek-search", "category-picker"),
      css('input[placeholder*="ubriek" i]', "CSS fallback: rubriek-zoekveld"),
      css('select[name^="cat_sel_"]', 'CSS: select[name^="cat_sel_"]'),
    ],
  },
  images: {
    kind: "file",
    candidates: [
      css('input[type="file"]', "CSS: input[type=file]"),
      ...label("/^voeg foto|^foto|^afbeelding/i"),
      ...testid("ad-images", "photo-upload", "image-upload", "file-upload", "image-uploader-box-label"),
      css("#imageUploader-hiddenInput", "CSS: #imageUploader-hiddenInput"),
    ],
  },
};

/**
 * The attribute keys the REAL Marktplaats form uses in
 * `name="singleSelectAttribute[…]"` / `name="numericAttribute[…]"` /
 * `data-testid` (inspected on www.marktplaats.nl/plaats, category
 * Telecommunicatie > Mobiele telefoons > Apple iPhone, 01-10-2026).
 *
 * Label matching stays the primary strategy — this is only a robust fallback
 * for when the label phrasing changes. Values are category-dependent, so a
 * miss here is never fatal.
 */
export const FIELD_MP_ATTRIBUTE_KEYS: Record<string, string[]> = {
  condition: ["condition"],
  storage_gb: ["storage"],
  subscription: ["subscription"],
  simlock: ["simlock"],
  model: ["type"],
  color: ["color"],
  battery_percentage: ["battery health"],
  manufacturer_name: ["manufacturer", "brand"],
  ram_gb: ["ram"],
  screen_size: ["screenSize"],
  chip: ["chip"],
};

/**
 * Candidates for one structured product field: the Marktplaats attribute
 * label (when we resolved one) first, then our own label, then the aliases,
 * then the real-form name/testid fallbacks.
 */
export function buildAttributeCandidates(params: {
  internalField: string;
  ownLabel: string;
  marktplaatsLabel?: string | null;
}): SelectorCandidate[] {
  const seen = new Set<string>();
  const patterns: string[] = [];
  const push = (value?: string | null) => {
    if (!value) return;
    const key = value.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    patterns.push(value.trim());
  };
  push(params.marktplaatsLabel);
  push(params.ownLabel);
  for (const alias of FIELD_LABEL_ALIASES[params.internalField] ?? []) push(alias);

  const candidates: SelectorCandidate[] = [];
  for (const pattern of patterns) {
    const exact = new RegExp(`^${escapeRegExp(pattern)}$`, "i");
    candidates.push({ strategy: "label", pattern: String(exact), note: `label "${pattern}"` });
    candidates.push({
      strategy: "role",
      role: "textbox",
      pattern: String(new RegExp(`^${escapeRegExp(pattern)}(\\s*\\(.*\\))?\\s*:?$`, "i")),
      note: `role/name "${pattern}"`,
    });
    candidates.push({
      strategy: "role",
      role: "combobox",
      pattern: String(new RegExp(`^${escapeRegExp(pattern)}(\\s*\\(.*\\))?\\s*:?$`, "i")),
      note: `combobox "${pattern}"`,
    });
  }

  const field = params.internalField;
  for (const mpKey of FIELD_MP_ATTRIBUTE_KEYS[field] ?? []) {
    candidates.push(
      css(`select[name="singleSelectAttribute[${mpKey}]"]`, `CSS: singleSelectAttribute[${mpKey}]`),
      css(`input[name="numericAttribute[${mpKey}]"]`, `CSS: numericAttribute[${mpKey}]`),
      css(`[data-testid*="${mpKey}" i]`, `CSS: data-testid*=${mpKey}`)
    );
  }
  candidates.push(css(`[data-testid*="${field}" i]`, `CSS: data-testid*=${field}`));
  candidates.push(css(`input[name*="${field}" i]`, `CSS: input[name*=${field}]`));
  candidates.push(css(`select[name*="${field}" i]`, `CSS: select[name*=${field}]`));
  candidates.push(css(`textarea[name*="${field}" i]`, `CSS: textarea[name*=${field}]`));
  candidates.push(xpath(`//label[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"${field.toLowerCase()}")]`, "XPath label"));
  return candidates;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is the pattern a regex literal like "/^Titel/i"? */
export function isRegexPattern(pattern: string): boolean {
  return pattern.length > 2 && pattern.startsWith("/") && pattern.lastIndexOf("/") > 0;
}

export function toRegExp(pattern: string): RegExp {
  const lastSlash = pattern.lastIndexOf("/");
  return new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1));
}
