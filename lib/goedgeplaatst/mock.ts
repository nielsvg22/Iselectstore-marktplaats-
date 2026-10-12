// MOCK MODE ONLY. Used whenever no real GOEDGEPLAATST_API_KEY is configured
// (see config.ts isGoedgeplaatstMockMode). Every value returned here is
// illustrative and prefixed so it can never be confused with a real,
// API-verified GoedGeplaatst id. Callers MUST surface `mock: true` to the UI
// — never render these as a real, verified "Verbonden" state (rule from
// STAP 10).

import { GoedgeplaatstAd, GoedgeplaatstCategoryAttributes, GoedgeplaatstCategoryGroup, GoedgeplaatstStatus, GoedgeplaatstUser } from "./types";

export const MOCK_CATEGORY_GROUPS: GoedgeplaatstCategoryGroup[] = [
  {
    groupId: 900001,
    groupDescription: "Telecommunicatie (mock)",
    categories: [
      { categoryId: 910001, descriptions: [{ locale: "nl_NL", description: "Telecommunicatie > Mobiele telefoons > Apple iPhone" }], status: "open" },
      { categoryId: 910002, descriptions: [{ locale: "nl_NL", description: "Telecommunicatie > Tablets > Apple iPad" }], status: "open" },
    ],
  },
  {
    groupId: 900002,
    groupDescription: "Computers en Software (mock)",
    categories: [
      { categoryId: 920001, descriptions: [{ locale: "nl_NL", description: "Computers en Software > Laptops > Apple MacBook" }], status: "open" },
      { categoryId: 920002, descriptions: [{ locale: "nl_NL", description: "Computers en Software > Desktops > Apple iMac / Mac mini" }], status: "open" },
    ],
  },
];

export function getMockCategoryAttributes(categoryId: number): GoedgeplaatstCategoryAttributes {
  return {
    categoryId,
    attributes: [
      {
        portal: "marktplaats",
        locale: "nl_NL",
        attributes: [
          { key: "mock_conditie", label: "Conditie", type: "LIST", mandatory: true, writable: true, updatable: true, values: [{ value: "Als nieuw" }, { value: "Zeer nette staat" }, { value: "Nette staat" }] },
          { key: "mock_kleur", label: "Kleur", type: "STRING", mandatory: false, writable: true, updatable: true },
          { key: "mock_opslagcapaciteit", label: "Opslagcapaciteit", type: "LIST", mandatory: false, writable: true, updatable: true, values: [{ value: "128GB" }, { value: "256GB" }, { value: "512GB" }] },
          // Since 1 Feb 2025: DSA/GPSR-verplichte fabrikantgegevens — ook in mock aanwezig zodat de attributenlijst-UI deze
          // altijd kan tonen/testen, ook zonder echte API-sleutel.
          { key: "manufacturerTradename", label: "Handelsnaam fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
          { key: "manufacturerAddress", label: "Adres fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
          { key: "manufacturerEmail", label: "E-mail fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
        ],
      },
    ],
  };
}

export function generateMockAdId(): number {
  // Clearly out of any real range + random, so it can never collide with or
  // be confused with a real GoedGeplaatst adId.
  return 9_000_000_000 + Math.floor(Math.random() * 999_999);
}

export function buildMockAd(input: { adId: number; title: string; description: string; categoryId: number; priceCents?: number; externalAdId?: number; imageUrls: string[] }): GoedgeplaatstAd {
  return {
    adId: input.adId,
    userId: 0,
    externalAdId: input.externalAdId,
    status: "concept",
    type: "supply",
    title: input.title,
    description: input.description,
    categoryId: input.categoryId,
    categoryDescription: "(mock categorie)",
    prices: input.priceCents ? { model: "fixed", price: input.priceCents } : undefined,
    images: input.imageUrls.map((url, i) => ({ adImageId: 9_000_000 + i, url })),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

export function buildMockStatus(adId: number, userId: number): GoedgeplaatstStatus {
  return {
    adId,
    userId,
    portals: [{ portal: "marktplaats", publish: { pending: false, active: false, online: false, error: null } }],
  };
}

export const MOCK_USER: GoedgeplaatstUser = { userId: 0, name: "(mock gebruiker)" };
