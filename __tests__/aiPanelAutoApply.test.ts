// Auto-toepassingsregel voor create-mode: HIGH/MEDIUM direct in het formulier,
// LOW nooit automatisch, conflicterende foto's altijd expliciet laten kiezen.
import { describe, it, expect } from "vitest";
import { isAutoApplyEligible, selectAutoApplyFields } from "@/app/admin/AIRecognitionPanel";

function field(overrides: Partial<Parameters<typeof isAutoApplyEligible>[0]> = {}) {
  return {
    key: "model",
    label: "Model",
    value: "iPhone 15 Pro" as string | number,
    confidence: 0.98,
    level: "HIGH" as const,
    ...overrides,
  };
}

describe("selectAutoApplyFields / isAutoApplyEligible", () => {
  it("past HIGH en MEDIUM direct toe", () => {
    const fields = [
      field({ key: "model", level: "HIGH" }),
      field({ key: "storage_gb", value: "256GB", level: "MEDIUM" }),
    ];
    const applied = selectAutoApplyFields({ fields });
    expect(applied).toEqual([
      { key: "model", value: "iPhone 15 Pro" },
      { key: "storage_gb", value: "256GB" },
    ]);
  });

  it("past LOW nooit automatisch toe", () => {
    const low = field({ key: "cycle_count", value: "87", level: "LOW", confidence: 0.2 });
    expect(isAutoApplyEligible(low)).toBe(false);
    expect(selectAutoApplyFields({ fields: [low] })).toEqual([]);
  });

  it("sluit conflicterende velden uit (gebruiker kiest zelf)", () => {
    const conflict = field({
      key: "storage_gb",
      value: "512GB",
      level: "HIGH",
      sourceConflict: [
        { imageIndex: 0, filename: "a.png", value: "512GB" },
        { imageIndex: 1, filename: "b.png", value: "1TB" },
      ],
    });
    expect(isAutoApplyEligible(conflict)).toBe(false);
    expect(selectAutoApplyFields({ fields: [conflict] })).toEqual([]);
  });

  it("houdt velden met een enkele bronwaarde gewoon over", () => {
    const single = field({
      key: "color",
      value: "Zwart",
      level: "MEDIUM",
      sourceConflict: [{ imageIndex: 0, filename: "a.png", value: "Zwart" }],
    });
    expect(isAutoApplyEligible(single)).toBe(true);
  });
});
