import { describe, it, expect } from "vitest";
import { normalizeRam, normalizeStorage, normalizeBatteryHealth, normalizeChip, normalizeModel } from "../lib/ai/normalize";

describe("AI normalizers", () => {
  it("normalizes RAM variants to a canonical GB string", () => {
    expect(normalizeRam("18 GB")).toBe("18GB");
    expect(normalizeRam("18GB")).toBe("18GB");
    expect(normalizeRam("18 Gb")).toBe("18GB");
  });

  it("normalizes storage variants to a canonical string", () => {
    expect(normalizeStorage("512 GB")).toBe("512GB");
    expect(normalizeStorage("512GB SSD")).toBe("512GB");
    expect(normalizeStorage("1 TB")).toBe("1TB");
  });

  it("normalizes battery health to a plain 0-100 number", () => {
    expect(normalizeBatteryHealth("94 %")).toBe(94);
    expect(normalizeBatteryHealth("94 percent")).toBe(94);
    expect(normalizeBatteryHealth("94%")).toBe(94);
    expect(normalizeBatteryHealth("150%")).toBeNull();
  });

  it("normalizes chip names with an Apple prefix", () => {
    expect(normalizeChip("M3 Pro")).toBe("Apple M3 Pro");
    expect(normalizeChip("Apple M3 Pro")).toBe("Apple M3 Pro");
  });

  it("never invents a value for null input", () => {
    expect(normalizeRam(null)).toBeNull();
    expect(normalizeStorage(null)).toBeNull();
    expect(normalizeBatteryHealth(null)).toBeNull();
    expect(normalizeChip(null)).toBeNull();
    expect(normalizeModel(null)).toBeNull();
  });
});
