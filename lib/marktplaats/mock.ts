// MOCK MODE ONLY. This module simulates Marktplaats responses so the rest of
// the pipeline (mapping, validation, title/description generation, payload
// preview) can be fully exercised without real credentials or without
// touching real advertisements. These attribute shapes follow the
// *documented* v2 schema exactly, but the keys/options are illustrative
// placeholders — never treat this as verified real category data. Real
// data always comes from apiClient.ts once credentials exist.

import { MarktplaatsCategoryAttribute } from "./types";

const MOCK_ATTRIBUTES_BY_L2: Record<string, MarktplaatsCategoryAttribute[]> = {
  // These keys are placeholders (prefixed mock_) so they can never be
  // confused with a real, API-verified attribute key.
  default: [
    { key: "mock_model", labels: { nl: "Model" }, type: "STRING", mandatory: true, searchable: true, writable: true, updateable: true, maxAllowedLength: 60 },
    { key: "mock_kleur", labels: { nl: "Kleur" }, type: "STRING", mandatory: false, searchable: true, writable: true, updateable: true },
    {
      key: "mock_opslagcapaciteit",
      labels: { nl: "Opslagcapaciteit" },
      type: "LIST",
      mandatory: false,
      searchable: true,
      writable: true,
      updateable: true,
      options: [
        { value: "64GB", labels: { nl: "64 GB" } },
        { value: "128GB", labels: { nl: "128 GB" } },
        { value: "256GB", labels: { nl: "256 GB" } },
        { value: "512GB", labels: { nl: "512 GB" } },
        { value: "1TB", labels: { nl: "1 TB" } },
      ],
    },
    {
      key: "mock_werkgeheugen",
      labels: { nl: "Werkgeheugen" },
      type: "LIST",
      mandatory: false,
      searchable: true,
      writable: true,
      updateable: true,
      options: [
        { value: "8GB", labels: { nl: "8 GB" } },
        { value: "16GB", labels: { nl: "16 GB" } },
        { value: "18GB", labels: { nl: "18 GB" } },
        { value: "24GB", labels: { nl: "24 GB" } },
        { value: "32GB", labels: { nl: "32 GB" } },
      ],
    },
    {
      key: "mock_conditie",
      labels: { nl: "Conditie" },
      type: "LIST",
      mandatory: true,
      searchable: true,
      writable: true,
      updateable: true,
      options: [
        { value: "Als nieuw", labels: { nl: "Als nieuw" } },
        { value: "Zeer nette staat", labels: { nl: "Zeer nette staat" } },
        { value: "Nette staat", labels: { nl: "Nette staat" } },
        { value: "Zichtbare gebruikssporen", labels: { nl: "Zichtbare gebruikssporen" } },
      ],
    },
    {
      key: "mock_batterijconditie",
      labels: { nl: "Batterijconditie" },
      type: "NUMBER",
      mandatory: false,
      searchable: true,
      writable: true,
      updateable: true,
      minValue: 0,
      maxValue: 100,
    },
    {
      key: "mock_abonnement",
      labels: { nl: "Abonnement" },
      type: "LIST",
      mandatory: false,
      searchable: true,
      writable: true,
      updateable: true,
      options: [
        { value: "Zonder abonnement", labels: { nl: "Zonder abonnement" } },
        { value: "Met abonnement", labels: { nl: "Met abonnement" } },
      ],
    },
    {
      key: "mock_simlock",
      labels: { nl: "Simlock" },
      type: "LIST",
      mandatory: false,
      searchable: true,
      writable: true,
      updateable: true,
      options: [
        { value: "Zonder simlock", labels: { nl: "Zonder simlock" } },
        { value: "Met simlock", labels: { nl: "Met simlock" } },
      ],
    },
    { key: "mock_fabrikant_naam", labels: { nl: "Handelsnaam fabrikant" }, type: "STRING", mandatory: false, searchable: false, writable: true, updateable: true },
    { key: "mock_fabrikant_adres", labels: { nl: "Postadres fabrikant" }, type: "STRING", mandatory: false, searchable: false, writable: true, updateable: true },
    { key: "mock_fabrikant_email", labels: { nl: "E-mailadres fabrikant" }, type: "STRING", mandatory: false, searchable: false, writable: true, updateable: true },
    { key: "mock_chip", labels: { nl: "Processor" }, type: "STRING", mandatory: false, searchable: true, writable: true, updateable: true },
    { key: "mock_kastmaat", labels: { nl: "Kastmaat" }, type: "STRING", mandatory: false, searchable: true, writable: true, updateable: true },
  ],
};

export function getMockCategoryAttributes(l2CategoryId: string): MarktplaatsCategoryAttribute[] {
  return MOCK_ATTRIBUTES_BY_L2[l2CategoryId] ?? MOCK_ATTRIBUTES_BY_L2.default;
}

export function generateMockAdvertisementId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
