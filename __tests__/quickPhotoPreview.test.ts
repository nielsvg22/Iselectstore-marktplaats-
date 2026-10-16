import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createCanvas, loadImage } from "@napi-rs/canvas";
vi.mock("@/lib/auth/extensionRequest", () => ({ authenticateExtensionRequest: vi.fn() }));
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { POST } from "@/app/api/shopify/quick-photo-preview/route";

function request(bytes: Uint8Array, name = "iphone.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return new NextRequest("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-photo-preview", { method: "POST", body: form });
}
beforeEach(() => { vi.mocked(authenticateExtensionRequest).mockReturnValue({ ok: true, claims: {} as never, headers: { "Access-Control-Allow-Origin": "https://admin.shopify.com" } }); });
describe("Foto-preview zonder product/media aanmaken", () => {
  it("vereist Shopify-authenticatie", async () => {
    vi.mocked(authenticateExtensionRequest).mockReturnValue({ ok: false, response: NextResponse.json({ error: "Niet geauthenticeerd" }, { status: 401 }) });
    expect((await POST(request(new Uint8Array([1])))).status).toBe(401);
  });
  it("retourneert een kleine decodeerbare JPEG-preview zonder cache", async () => {
    const canvas = createCanvas(640, 400);
    const response = await POST(request(canvas.toBuffer("image/png")));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { preview } = await response.json();
    const image = await loadImage(Buffer.from(preview.split(",")[1], "base64"));
    expect([image.width, image.height]).toEqual([320, 200]);
  });
  it("weigert onleesbare, lege, te grote en niet-afbeeldingsbestanden", async () => {
    for (const req of [request(new Uint8Array([1])), request(new Uint8Array()), request(new Uint8Array(3 * 1024 * 1024 + 1)), request(new Uint8Array([1]), "bad.pdf", "application/pdf")]) {
      expect((await POST(req)).status).toBe(400);
    }
  });
});
