import { describe, it, expect } from "vitest";
import { buildManualAdPayload, buildAdPayloadFromShopifyPreview } from "@/lib/goedgeplaatst/mapper";
import { GoedgeplaatstAttributeDefinition } from "@/lib/goedgeplaatst/types";
import { ProductPreview } from "@/lib/marktplaats/orchestrator";

function makePreview(partial: Partial<ProductPreview> = {}): ProductPreview {
  return {
    shopifyProductId: "123",
    productType: "iPhone",
    shopifyTitle: "iPhone 15 Pro 256GB",
    marktplaatsTitle: "iPhone 15 Pro 256GB",
    marktplaatsDescription: "Nette iPhone.",
    categoryMapping: null as unknown as ProductPreview["categoryMapping"],
    mappingSource: "mock",
    attributeResults: [],
    validation: { checks: [], publishable: true } as unknown as ProductPreview["validation"],
    payloadPreview: {} as unknown as ProductPreview["payloadPreview"],
    imageUrls: [],
    ean: null,
    template: {} as unknown as ProductPreview["template"],
    data: {},
    price: 999,
    ...partial,
  };
}

const baseAttributes: GoedgeplaatstAttributeDefinition[] = [
  { key: "mock_conditie", label: "Conditie", type: "LIST", mandatory: false, writable: true, updatable: true },
];

const gpsrAttributes: GoedgeplaatstAttributeDefinition[] = [
  ...baseAttributes,
  { key: "manufacturerTradename", label: "Handelsnaam fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
  { key: "manufacturerAddress", label: "Adres fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
  { key: "manufacturerEmail", label: "E-mail fabrikant", type: "STRING", mandatory: true, writable: true, updatable: true },
];

describe("GoedGeplaatst mapper", () => {
  it("rekent euro's om naar centen voor price.price", () => {
    const { payload } = buildManualAdPayload({
      input: { title: "Test iPhone 13 128GB", description: "Een nette iPhone.", priceEuros: 249.95, imageUrls: [] },
      userId: 1,
      categoryId: 123,
      categoryAttributes: baseAttributes,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(payload.price.model).toBe("fixed");
    expect(payload.price.price).toBe(24995);
  });

  it("stuurt status altijd 'concept' en type altijd 'supply'", () => {
    const { payload } = buildManualAdPayload({
      input: { title: "Test iPhone 13 128GB", description: "Een nette iPhone.", priceEuros: 100, imageUrls: [] },
      userId: 1,
      categoryId: 123,
      categoryAttributes: baseAttributes,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(payload.status).toBe("concept");
    expect(payload.type).toBe("supply");
  });

  it("kapt de titel af op 60 tekens", () => {
    const longTitle = "X".repeat(80);
    const { payload } = buildManualAdPayload({
      input: { title: longTitle, description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: [],
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(payload.title.length).toBe(60);
  });

  it("meldt ontbrekende GPSR-fabrikantgegevens als missingMandatory zonder manufacturer-config", () => {
    const { missingMandatory } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: gpsrAttributes,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(missingMandatory).toEqual(expect.arrayContaining(["manufacturerTradename", "manufacturerAddress", "manufacturerEmail"]));
  });

  it("vult GPSR-fabrikantgegevens in vanuit manufacturer-config zonder ze te verzinnen", () => {
    const { payload, missingMandatory } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: gpsrAttributes,
      manufacturer: { tradename: "iSelectStore BV", address: "Teststraat 1, 1234 AB Stad", email: "info@iselectstore.nl" },
    });
    expect(missingMandatory).toEqual([]);
    const values = payload.attributes[0].values;
    expect(values).toEqual(
      expect.arrayContaining([
        { key: "manufacturerTradename", value: "iSelectStore BV" },
        { key: "manufacturerAddress", value: "Teststraat 1, 1234 AB Stad" },
        { key: "manufacturerEmail", value: "info@iselectstore.nl" },
      ])
    );
  });

  it("vult 'delivery' alleen vanuit het handmatige invulveld (geen Shopify-bron)", () => {
    const attrs: GoedgeplaatstAttributeDefinition[] = [
      { key: "delivery", label: "Levering", type: "LIST", mandatory: false, writable: true, updatable: true, values: [{ value: "Ophalen" }, { value: "Verzenden" }] },
    ];
    const { payload, attributeStatuses } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
      manualOverrides: { delivery: "Ophalen" },
    });
    expect(attributeStatuses).toEqual([{ key: "delivery", label: "Levering", mandatory: false, value: "Ophalen", source: "manual" }]);
    expect(payload.attributes[0].values).toEqual([{ key: "delivery", value: "Ophalen" }]);
  });

  it("gebruikt een handmatig ingevoerde EAN niet als Shopify al een barcode heeft (ean blijft optioneel, nooit verzonnen)", () => {
    const attrs: GoedgeplaatstAttributeDefinition[] = [
      { key: "ean", label: "Productnummer EAN", type: "STRING", mandatory: false, writable: true, updatable: true },
    ];
    const { attributeStatuses: withoutOverride } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(withoutOverride).toEqual([{ key: "ean", label: "Productnummer EAN", mandatory: false, value: null, source: "missing" }]);

    const { attributeStatuses: withOverride } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
      manualOverrides: { ean: "0194253715816" },
    });
    expect(withOverride).toEqual([{ key: "ean", label: "Productnummer EAN", mandatory: false, value: "0194253715816", source: "manual" }]);
  });

  it("gebruikt Shopify's barcode (EAN) automatisch, en negeert een handmatige EAN wanneer Shopify er al een heeft", () => {
    const attrs: GoedgeplaatstAttributeDefinition[] = [
      { key: "ean", label: "Productnummer EAN", type: "STRING", mandatory: false, writable: true, updatable: true },
    ];
    const { attributeStatuses } = buildAdPayloadFromShopifyPreview({
      preview: makePreview({ ean: "8712345678901" }),
      userId: 1,
      categoryId: 1737,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
      manualOverrides: { ean: "0000000000000" }, // moet genegeerd worden — Shopify heeft al een barcode
    });
    expect(attributeStatuses).toEqual([{ key: "ean", label: "Productnummer EAN", mandatory: false, value: "8712345678901", source: "shopify" }]);
  });

  it("vult 'model' (key: type) vanuit de Shopify-attribuutmapping, niet vanuit de (kapotte) Marktplaats-catalogusvalidatie", () => {
    const attrs: GoedgeplaatstAttributeDefinition[] = [
      { key: "type", label: "Model", type: "LIST", mandatory: true, writable: true, updatable: true, values: [{ value: "iPhone 15 Pro" }] },
    ];
    const { attributeStatuses, missingMandatory } = buildAdPayloadFromShopifyPreview({
      preview: makePreview({
        attributeResults: [
          {
            internalField: "model",
            label: "Model",
            shopifyValue: "iPhone 15 Pro",
            marktplaatsAttributeKey: "type",
            // Simulates the broken Marktplaats catalog: marktplaatsValue is
            // null even though the key/value we need are both known.
            marktplaatsValue: null,
            status: "no_matching_attribute",
          },
        ],
      }),
      userId: 1,
      categoryId: 1737,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(attributeStatuses).toEqual([{ key: "type", label: "Model", mandatory: true, value: "iPhone 15 Pro", source: "shopify" }]);
    expect(missingMandatory).toEqual([]);
  });

  it("neemt alleen schrijfbare attributen mee", () => {
    const attrs: GoedgeplaatstAttributeDefinition[] = [
      { key: "readonly_key", label: "Alleen-lezen", type: "STRING", mandatory: false, writable: false, updatable: false },
    ];
    const { payload, attributeStatuses } = buildManualAdPayload({
      input: { title: "Test", description: "Omschrijving", priceEuros: 10, imageUrls: [] },
      userId: 1,
      categoryId: 1,
      categoryAttributes: attrs,
      manufacturer: { tradename: null, address: null, email: null },
    });
    expect(attributeStatuses).toHaveLength(0);
    expect(payload.attributes[0].values).toHaveLength(0);
  });
});
