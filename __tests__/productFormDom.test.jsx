// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { ProductForm } from "../extensions/shared/ProductForm.jsx";

// Regressietest voor de JSX-runtime van gedeelde extension-componenten.
// ProductForm.jsx valt buiten de tsconfig's van de extension-mappen; als die
// file met de React-jsx-runtime compileert vriest React de elementen en
// crasht Preact tijdens het renderen ("Cannot add property __, object is not
// extensible") — de merchant ziet dan een lege dropdown zonder opties.
describe("ProductForm DOM-render onder Preact", () => {
  it("rendert template-selects met opties en velden", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      h(ProductForm, {
        productType: "iPhone",
        onProductTypeChange: () => {},
        status: "draft",
        onStatusChange: () => {},
        values: {},
        issues: {},
        onChange: () => {},
      }),
      container
    );
    expect(container.querySelectorAll("s-select").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("s-option").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll("s-text-field").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("s-select").getAttribute("label")).toBe(
      "Producttype (iSelect-template)"
    );
  });
});
