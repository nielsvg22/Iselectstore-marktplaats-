// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

vi.mock("@shopify/ui-extensions/preact", () => ({}));
vi.mock("../extensions/shared/api.js", () => ({
  BACKEND_URL: "https://iselectstore-marktplaats-app.vercel.app",
  getIdToken: vi.fn(), callBackend: vi.fn(), uploadImages: vi.fn(),
}));
import openAction from "../extensions/iselect-quick-create/src/ActionExtension.jsx";
import { callBackend, getIdToken, uploadImages } from "../extensions/shared/api.js";

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
  callBackend.mockResolvedValue({ ok: true, data: product });
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
    submit(); submit(); await flush();
    expect(callBackend).toHaveBeenCalledTimes(1);
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
    await flush(); submit(); await flush();
    expect(callBackend).toHaveBeenCalledWith("/api/shopify/quick-image", { token: "test-token", body: { productId: "123", filename: "ai.jpg", data: "aW1hZ2U=" } });
    expect(uploadImages).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 foto toegevoegd.");
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
  });

  it("meldt een uploadfout zonder tweede uploadbox of opnieuw een product aan te maken", async () => {
    uploadImages.mockResolvedValue({ added: 0, error: "Upload mislukt." });
    choose(new File(["jpeg"], "iphone.jpg", { type: "image/jpeg" }));
    submit(); await flush();
    expect(document.querySelector('s-banner[tone="warning"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Maak het product niet opnieuw aan.");
    expect(document.querySelectorAll("s-drop-zone")).toHaveLength(0);
    expect(document.querySelector('s-link[href="shopify:admin/products/123"]')).toBeTruthy();
    expect(callBackend).toHaveBeenCalledTimes(1);
  });
});
