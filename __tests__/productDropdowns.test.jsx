// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { ProductField, ProductForm } from "../extensions/shared/ProductForm.jsx";
import { getTemplate, listProductTypes } from "../lib/templates/registry";
import { validateQuickProductData } from "../lib/templates/quickProduct";
import { GOEDGEPLAATST_ATTRIBUTE_MAP } from "../lib/goedgeplaatst/attributeMap";

let container;
afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
});
function mount(component) {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(component, container);
  return container;
}
function selectValues(select) {
  return [...select.querySelectorAll("s-option")].map((option) => option.getAttribute("value"));
}

describe("iSelect-dropdowns in beide Shopify-adminextensions", () => {
  it.each(listProductTypes())("rendert de select-opties uit de gedeelde %s-template", (type) => {
    mount(h(ProductForm, { productType: type, values: {}, issues: {}, onChange: vi.fn() }));
    for (const field of getTemplate(type).fields.filter((f) => f.kind === "select")) {
      const label = field.required ? field.label : `${field.label} (optioneel)`;
      const select = [...container.querySelectorAll("s-select")].find((el) => el.getAttribute("label") === label);
      expect(select, field.key).toBeTruthy();
      expect(selectValues(select)).toEqual(["", ...field.options]);
    }
  });

  it("herstelt Model en Schermformaat voor MacBook en verwerkt geldige keuzes", () => {
    const template = getTemplate("MacBook");
    const values = { model: "Pro", screen_size: "16", chip: "M3", ram_gb: "16", storage_gb: "512", color: "Zwart", condition: "Als nieuw", sell_price: "999" };
    expect(validateQuickProductData("MacBook", values).issues.map((i) => i.key)).toEqual(["model", "screen_size"]);
    mount(h(ProductForm, { productType: "MacBook", values, issues: {}, onChange: (key, value) => { values[key] = value; } }));
    for (const [key, next] of [["model", "MacBook Pro"], ["screen_size", "16 inch"]]) {
      const field = template.fields.find((f) => f.key === key);
      const select = [...container.querySelectorAll("s-select")].find((el) => el.getAttribute("label").startsWith(field.label));
      const legacy = [...select.querySelectorAll("s-option")].find((opt) => opt.hasAttribute("disabled"));
      expect(legacy.textContent).toContain(values[key]);
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(values[key]).toBe(next);
    }
    expect(validateQuickProductData("MacBook", values).ok).toBe(true);
    const mappings = GOEDGEPLAATST_ATTRIBUTE_MAP.MacBook;
    expect(mappings.model.transform(values.model)).toBe("MacBook Pro");
    expect(mappings.screenSize.shopifyField).toBe("screen_size");
  });

  it("kan een optioneel schermformaat wissen en accepteert geen onbekende keuze", () => {
    const onChange = vi.fn();
    const field = getTemplate("MacBook").fields.find((f) => f.key === "screen_size");
    mount(h(ProductField, { field, value: "16 inch", onChange }));
    const select = container.querySelector("s-select");
    select.value = "";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("");
    onChange.mockClear();
    select.value = "16";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
