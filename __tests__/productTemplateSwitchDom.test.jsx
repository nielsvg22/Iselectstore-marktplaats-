// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { ProductForm } from "../extensions/shared/ProductForm.jsx";
import { getTemplate } from "../lib/templates/registry";
import { applyTemplateDefaults } from "../lib/templates/quickProduct";

// Regressietest voor spec-onderdeel 4 (template-bug): wisselen van producttype
// moet de zichtbare velden direct vervangen (input-event, niet pas bij blur).
// Apple Watch mag géén MacBook-velden tonen (Schermformaat/Modeljaar/Chip/
// CPU/GPU/RAM) en vice versa.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function Harness() {
  const [productType, setProductType] = useState("iPhone");
  const [values, setValues] = useState(() => applyTemplateDefaults(getTemplate("iPhone"), {}));

  function handleType(next) {
    setProductType(next);
    setValues(applyTemplateDefaults(getTemplate(next), {}));
  }

  return h(ProductForm, {
    productType,
    onProductTypeChange: handleType,
    status: "draft",
    onStatusChange: () => {},
    values,
    issues: {},
    onChange: (key, value) => setValues((prev) => ({ ...prev, [key]: value })),
    aiShortcut: h("span", { id: "ai-shortcut" }, "Haal info op via AI-foto"),
  });
}

function fieldLabels(container) {
  return [
    ...container.querySelectorAll(
      "s-text-field, s-number-field, s-select, s-text-area, s-checkbox"
    ),
  ].map((el) => el.getAttribute("label") || "");
}

// Optionele velden tonen "<label> (optioneel)" — match op het gedeelte.
function hasLabel(labels, name) {
  return labels.some((l) => l.includes(name));
}

async function switchType(container, next) {
  const typeSelect = container.querySelector('s-select[label="Producttype (iSelect-template)"]');
  expect(typeSelect).toBeTruthy();
  typeSelect.value = next;
  typeSelect.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

describe("ProductForm producttype-wissel (spec §4)", () => {
  it("toont iPhone-velden, wisselt naar MacBook en daarna naar Apple Watch", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(h(Harness, {}), container);
    await flush();

    // iPhone
    let labels = fieldLabels(container);
    expect(hasLabel(labels, "SIM")).toBe(true);
    expect(hasLabel(labels, "Opslag (GB)")).toBe(true);
    expect(hasLabel(labels, "Chip")).toBe(false);
    expect(container.querySelector("#ai-shortcut")?.textContent).toContain("Haal info op via AI-foto");

    // MacBook: chip/CPU/GPU/RAM wel, iPhone-SIM niet, en zeker geen watch-velden
    await switchType(container, "MacBook");
    labels = fieldLabels(container);
    expect(hasLabel(labels, "Chip")).toBe(true);
    expect(hasLabel(labels, "RAM (GB)")).toBe(true);
    expect(hasLabel(labels, "Schermformaat")).toBe(true);
    expect(hasLabel(labels, "CPU-variant")).toBe(true);
    expect(hasLabel(labels, "GPU-variant")).toBe(true);
    expect(hasLabel(labels, "SIM")).toBe(false);
    expect(hasLabel(labels, "Kastmaat")).toBe(false);

    // Apple Watch (acceptatie spec §4): géén MacBook-/chip-velden
    await switchType(container, "Apple Watch");
    labels = fieldLabels(container);
    expect(hasLabel(labels, "Kastmaat")).toBe(true);
    expect(hasLabel(labels, "Serie")).toBe(true);
    expect(hasLabel(labels, "Chip")).toBe(false);
    expect(hasLabel(labels, "RAM (GB)")).toBe(false);
    expect(hasLabel(labels, "Schermformaat")).toBe(false);
    expect(hasLabel(labels, "CPU-variant")).toBe(false);
    expect(hasLabel(labels, "GPU-variant")).toBe(false);
    expect(hasLabel(labels, "Modeljaar")).toBe(false);
    expect(hasLabel(labels, "SIM")).toBe(false);

    render(null, container);
    container.remove();
  });
});
