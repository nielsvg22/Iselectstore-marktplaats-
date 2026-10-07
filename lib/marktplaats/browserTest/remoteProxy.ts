import { NextRequest, NextResponse } from "next/server";

/**
 * Lets the browser-test API routes run on Vercel too, even though Playwright
 * itself never can there (no display, ephemeral filesystem). When
 * MARKTPLAATS_BROWSER_TEST is off locally but MARKTPLAATS_BROWSER_REMOTE_URL
 * points at the Coolify instance where it IS on, every browser-test route
 * forwards the request there server-to-server instead of 403-ing — the admin
 * UI's "Test op Marktplaats" button then works from whichever host it's
 * opened on. Server-to-server means no CORS/mixed-content restrictions, even
 * though this app is served over HTTPS and the Coolify one over plain HTTP.
 */
function remoteBaseUrl(): string | null {
  return process.env.MARKTPLAATS_BROWSER_REMOTE_URL?.trim().replace(/\/$/, "") || null;
}

export function hasRemoteBrowserTest(): boolean {
  return remoteBaseUrl() !== null;
}

export async function proxyToRemoteBrowserTest(req: NextRequest, path: string): Promise<NextResponse> {
  const base = remoteBaseUrl();
  if (!base) {
    return NextResponse.json({ error: "MARKTPLAATS_BROWSER_REMOTE_URL is niet geconfigureerd." }, { status: 500 });
  }

  const url = `${base}${path}${req.nextUrl.search}`;
  const init: RequestInit = { method: req.method, headers: { "Content-Type": "application/json" } };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res = await fetch(url, init);
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Kon de Marktplaats-browserbot niet bereiken (${base}): ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
