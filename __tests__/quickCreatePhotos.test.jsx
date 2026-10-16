// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

vi.mock("@shopify/ui-extensions/preact", () => ({}));
vi.mock("../extensions/shared/api.js", () => ({
  BACKEND_URL: "https://iselectstore-marktplaats-app.vercel.app",
  getIdToken: vi.fn(), callBackend: vi.fn(), uploadImages: vi.fn(), previewImageFile: vi.fn(),
}));
import openAction from "../extensions/iselect-quick-create/src/ActionExtension.jsx";
import { callBackend, getIdToken, uploadImages, previewImageFile } from "../extensions/shared/api.js";

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const values = { Model: "iPhone 15 Pro", "Opslag (GB)": "256", Kleur: "Zwart", Conditie: "Als nieuw", Verkoopprijs: "569" };
const product = { productId: "123", title: "iPhone 15 Pro", status: "draft", shopifyTitle: "iPhone 15 Pro", marktplaatsTitle: "iPhone 15 Pro" };
function click(element) { act(() => element.dispatchEvent(new Event("click", { bubbles: true }))); }
function submit() { click(document.querySelector('[slot="primary-action"]')); }
function choose(file) {
  const zone = document.querySelector("s-drop-zone");
  Object.defineProperty(zone, "files", { configurable: true, value: [file] });
  act(() => {
    zone.dispatchEvent(new Event("input", { bubbles: true }));
    zone.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  globalThis.shopify = { close: vi.fn() };
  getIdToken.mockResolvedValue("test-token");
  previewImageFile.mockResolvedValue({ preview: "data:image/jpeg;base64,cHJldmlldw==" });
  callBackend.mockImplementation(async (path) => path === "/api/shopify/quick-review"
    ? { ok: true, data: { source: "cache", missingMandatory: [], checks: [] } }
    : { ok: true, data: product });
  uploadImages.mockResolvedValue({ added: 1, error: "" });
  await act(() => openAction());
  for (const [label, value] of Object.entries(values)) {
    const field = [...document.querySelectorAll("s-select, s-number-field")].find((el) => el.getAttribute("label") === label);
    act(() => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
});
afterEach(() => { act(() => render(null, document.body)); delete globalThis.shopify; });

describe("Verplichte foto's vóór iSelect-productcreatie", () => {
  it("blokkeert creatie zonder foto en toont de fout bij de enige uploadbox", async () => {
    submit(); await flush();
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(1);
    expect(document.querySelector("s-drop-zone").getAttribute("error")).toContain("Upload minimaal één foto");
    expect(callBackend).not.toHaveBeenCalled();
    expect(uploadImages).not.toHaveBeenCalled();
  });

  it.each([
    new File(["x"], "test.pdf", { type: "application/pdf" }),
    new File([new Uint8Array(3 * 1024 * 1024 + 1)], "groot.jpg", { type: "image/jpeg" }),
    new File([], "leeg.jpg", { type: "image/jpeg" }),
  ])("telt een ongeschikt bestand niet als verplichte foto", async (file) => {
    choose(file);
    expect(document.querySelector("s-drop-zone").getAttribute("error")).toBeTruthy();
    submit(); await flush();
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("uploadt de eerste selectie eenmaal, blokkeert dubbel aanmaken en toont daarna geen uploadbox", async () => {
    let finish;
    uploadImages.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const file = new File(["jpeg"], "iphone.jpg", { type: "image/jpeg" });
    choose(file);
    await flush(); submit(); await flush();
    expect(callBackend.mock.calls.filter(([path]) => path === "/api/shopify/quick-create")).toHaveLength(0);
    submit(); submit(); await flush();
    expect(callBackend.mock.calls.filter(([path]) => path === "/api/shopify/quick-create")).toHaveLength(1);
    expect(uploadImages).toHaveBeenCalledWith({ token: "test-token", productId: "123", files: [file] });
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
    expect(document.querySelector('[slot="primary-action"]').hasAttribute("disabled")).toBe(true);
    click(document.querySelector('[slot="secondary-actions"]'));
    expect(shopify.close).not.toHaveBeenCalled();
    await act(async () => finish({ added: 1, error: "" }));
    expect(document.body.textContent).toContain("1 foto toegevoegd.");
    expect(document.querySelector('s-banner[tone="success"]')).toBeTruthy();
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
  });

  it("accepteert een foto uit de bestaande AI-koppeling", async () => {
    callBackend.mockImplementation(async (path) => path.includes("/draft?")
      ? { ok: true, data: { draft: { images: [{ filename: "ai.jpg", dataUrl: "data:image/jpeg;base64,aW1hZ2U=" }], values: {}, updatedAt: Date.now() } } }
      : { ok: true, data: product });
    click([...document.querySelectorAll("s-button")].find((el) => el.textContent.includes("Nu ophalen")));
    await flush(); submit(); await flush(); submit(); await flush();
    expect(callBackend).toHaveBeenCalledWith("/api/shopify/quick-image", { token: "test-token", body: { productId: "123", filename: "ai.jpg", data: "aW1hZ2U=" } });
    expect(uploadImages).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 foto toegevoegd.");
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
  });

  it("meldt een uploadfout zonder tweede uploadbox of opnieuw een product aan te maken", async () => {
    uploadImages.mockResolvedValue({ added: 0, error: "Upload mislukt." });
    choose(new File(["jpeg"], "iphone.jpg", { type: "image/jpeg" }));
    await flush(); submit(); await flush(); submit(); await flush();
    expect(document.querySelector('s-banner[tone="warning"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Maak het product niet opnieuw aan.");
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
    expect(document.querySelector('s-link[href="shopify:admin/products/123"]')).toBeTruthy();
    expect(callBackend.mock.calls.filter(([path]) => path === "/api/shopify/quick-create")).toHaveLength(1);
  });

  it("toont miniaturen, verwijdert foto's en uploadt de gekozen hoofdfoto als eerste", async () => {
    for (const name of ["a.jpg", "b.jpg", "c.jpg"]) choose(new File(["jpeg"], name, { type: "image/jpeg" }));
    await flush();
    expect(document.querySelectorAll("s-thumbnail")).toHaveLength(3);
    click(document.querySelector('[accessibilityLabel="Verwijder foto 2"]'));
    const mainButtons = [...document.querySelectorAll("s-button")].filter((b) => b.textContent === "Als hoofdfoto");
    click(mainButtons[1]);
    await flush();
    expect([...document.querySelectorAll("s-thumbnail")].map((t) => t.getAttribute("alt"))).toEqual(["Foto 1: c.jpg", "Foto 2: a.jpg"]);
    click(document.querySelector('[accessibilityLabel="Foto 1 omlaag"]'));
    click(document.querySelector('[accessibilityLabel="Foto 2 omhoog"]'));
    submit(); await flush();
    expect(document.body.textContent).toContain("Prijs: €");
    expect(document.body.textContent).toContain("569,00");
    expect(document.body.textContent).toContain("Opslag (GB): 256");
    expect(callBackend.mock.calls.filter(([path]) => path === "/api/shopify/quick-create")).toHaveLength(0);
    // Going back keeps the selection and forces a fresh review after edits.
    click(document.querySelector('[slot="secondary-actions"]'));
    const price = document.querySelector('s-number-field[label="Verkoopprijs"]');
    act(() => { price.value = "599"; price.dispatchEvent(new Event("input", { bubbles: true })); });
    submit(); await flush();
    expect(document.body.textContent).toContain("599,00");
    submit(); await flush();
    expect(uploadImages.mock.calls.map(([arg]) => arg.files[0].name)).toEqual(["c.jpg", "a.jpg"]);
    expect(callBackend.mock.calls.find(([path]) => path === "/api/shopify/quick-create")[1].body.values.sell_price).toBe("599");
  });

  it("haalt een verwijderde AI-foto bij opnieuw ophalen niet terug", async () => {
    callBackend.mockResolvedValue({ ok: true, data: { draft: { images: [{ filename: "ai.jpg", dataUrl: "data:image/jpeg;base64,aW1hZ2U=" }], values: {}, updatedAt: Date.now() } } });
    const pull = () => click([...document.querySelectorAll("s-button")].find((el) => el.textContent.includes("Nu ophalen")));
    pull(); await flush();
    click(document.querySelector('[accessibilityLabel="Verwijder foto 1"]'));
    pull(); await flush();
    expect(document.querySelectorAll("s-thumbnail")).toHaveLength(0);
    submit(); await flush();
    expect(document.querySelector("s-drop-zone").getAttribute("error")).toContain("Upload minimaal één foto");
  });

  it("blokkeert controle bij een mislukt voorbeeld en laat alleen dat voorbeeld opnieuw laden", async () => {
    previewImageFile.mockResolvedValueOnce({ error: "Onleesbare foto" });
    choose(new File(["jpeg"], "iphone.jpg", { type: "image/jpeg" }));
    await flush(); submit(); await flush();
    expect(callBackend).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Onleesbare foto");
    click([...document.querySelectorAll("s-button")].find((b) => b.textContent === "Voorbeeld opnieuw laden"));
    await flush(); submit(); await flush();
    expect(document.body.textContent).toContain("Controleer je product");
  });
});
