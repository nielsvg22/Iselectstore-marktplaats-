import { describe, it, expect } from "vitest";
import { buildManualAdPayload } from "@/lib/goedgeplaatst/mapper";
import { GoedgeplaatstAttributeDefinition } from "@/lib/goedgeplaatst/types";

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
