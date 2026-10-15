import { NextRequest, NextResponse } from "next/server";
import { getBrowserTestConfig, isBrowserTestEnabled } from "@/lib/marktplaats/browserTest/config";
import { hasRemoteBrowserTest, remoteBrowserTestOrigin } from "@/lib/marktplaats/browserTest/remoteProxy";
import { consumeVncSessionToken } from "@/lib/marktplaats/browserTest/vncSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/marktplaats/browser-test/vnc-proxy/[...path]
 *
 * Serves the live-browser viewer, reachable only through this app's own
 * domain — never the raw, directly-exposed noVNC/websockify address
 * (docker/entrypoint.sh starts websockify on 127.0.0.1:6080, in the SAME
 * container as this Next.js app, so plain loopback fetches reach it with no
 * extra infra).
 *
 * Two kinds of paths:
 *
 *  - "vnc.html?session=<token>" — OUR OWN minimal viewer page (not noVNC's
 *    stock vnc.html), built directly on noVNC's RFB client module — the same
 *    approach as noVNC's own vnc_lite.html example. It validates the
 *    one-time token minted by vnc-session/route.ts and, only once that
 *    succeeds, injects the real VNC_PASSWORD into the page body so the
 *    embedded RFB client connects automatically. The password is NEVER put
 *    in a URL/querystring — it only ever appears in this response's BODY,
 *    which is always sent with Cache-Control: no-store and only reachable
 *    after a valid, single-use token check.
 *
 *  - anything else — noVNC's own static files (core/rfb.js and everything
 *    it imports), proxied byte-for-byte from the local noVNC instance so the
 *    viewer page above can load them via ordinary relative imports.
 *
 * The actual RFB-over-WebSocket traffic (the same path with an `Upgrade:
 * websocket` header) never reaches this route handler — a Next.js Route
 * Handler cannot see raw `upgrade` events. That half is proxied by the
 * custom server instead (see server.js, which this image now starts
 * instead of `next start` — see Dockerfile/package.json).
 *
 * On an instance with no local noVNC (e.g. this app deployed on Vercel,
 * where isBrowserTestEnabled() is false and MARKTPLAATS_BROWSER_REMOTE_URL
 * points at Coolify), every path here redirects the browser straight to the
 * Coolify instance's own copy of this same route instead of double-proxying
 * bytes through Vercel — the WebSocket upgrade has to terminate on the box
 * that actually runs websockify, which a Vercel serverless function can
 * never be. After that redirect, the viewer page's own relative requests
 * (its static assets and its WebSocket) go straight to Coolify, with Vercel
 * out of the loop entirely.
 */

const LOCAL_NOVNC_BASE = "http://127.0.0.1:6080";

// Must match the path server.js's `upgrade` listener matches and proxies to
// 127.0.0.1:6080 — keep these two in sync if either one ever changes.
const VNC_WEBSOCKET_PATH = "/api/marktplaats/browser-test/vnc-proxy/websockify";

function sanitizeRelPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
    return null;
  }
  return segments.join("/");
}

const NO_STORE_HEADERS: HeadersInit = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) {
  const relPath = sanitizeRelPath(params.path);
  if (relPath === null) {
    return NextResponse.json({ error: "Ongeldig pad." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const config = getBrowserTestConfig();
  const localPassword = config.novncPassword;

  if (!localPassword) {
    if (!isBrowserTestEnabled() && hasRemoteBrowserTest()) {
      const remote = remoteBrowserTestOrigin();
      const target = `${remote}/api/marktplaats/browser-test/vnc-proxy/${relPath}${req.nextUrl.search}`;
      return NextResponse.redirect(target, 307);
    }
    return NextResponse.json(
      { error: "Live weergave is hier niet beschikbaar." },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  if (relPath === "vnc.html") {
    return serveViewerPage(req, localPassword);
  }

  return proxyStaticAsset(relPath, req.nextUrl.search);
}

function serveViewerPage(req: NextRequest, password: string): NextResponse {
  const token = req.nextUrl.searchParams.get("session");
  if (!token) {
    return new NextResponse("Ontbrekend sessie-token.", { status: 400, headers: NO_STORE_HEADERS });
  }

  const validated = consumeVncSessionToken(token);
  if (!validated) {
    return new NextResponse(
      "Sessie-token is ongeldig of verlopen. Vraag opnieuw een live sessie aan.",
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const html = buildViewerHtml(validated);
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE_HEADERS },
  });
}

function buildViewerHtml(password: string): string {
  // JSON.stringify both escapes and quotes the value safely for inline use
  // inside a <script type="module"> text node (no HTML-entity or
  // closing-tag concerns the way string concatenation would have).
  const safePassword = JSON.stringify(password);
  const safeWsPath = JSON.stringify(VNC_WEBSOCKET_PATH);
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>Marktplaats live browser</title>
    <style>
      html, body { margin: 0; height: 100%; background: #111; overflow: hidden; }
      #screen { width: 100%; height: 100%; }
      #status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9ca3af; font: 13px system-ui, sans-serif; text-align: center; padding: 16px; }
    </style>
  </head>
  <body>
    <div id="screen"></div>
    <div id="status"></div>
    <script type="module">
      import RFB from "./core/rfb.js";

      // The real VNC_PASSWORD is injected here server-side, ONLY after this
      // request's one-time ?session= token was validated — see
      // app/api/marktplaats/browser-test/vnc-proxy/[...path]/route.ts. It
      // never appears in this page's own URL/querystring, browser history,
      // a Referer header, or any unauthenticated API response.
      const password = ${safePassword};
      const wsScheme = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = wsScheme + "//" + location.host + ${safeWsPath};

      const screen = document.getElementById("screen");
      const status = document.getElementById("status");

      const rfb = new RFB(screen, wsUrl, { credentials: { password } });
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.showDotCursor = true;

      rfb.addEventListener("disconnect", () => {
        status.textContent = "Verbinding met de live browser is verbroken. Vraag opnieuw een live sessie aan.";
      });
      rfb.addEventListener("credentialsrequired", () => {
        // Should never happen — the real password is always supplied above
        // — but fail loudly instead of silently falling back to noVNC's own
        // password prompt.
        status.textContent = "Kon niet automatisch verbinden.";
      });
      rfb.addEventListener("securityfailure", (e) => {
        status.textContent = "Beveiligde verbinding mislukt: " + (e.detail && e.detail.reason ? e.detail.reason : "onbekende fout");
      });
    </script>
  </body>
</html>`;
}

async function proxyStaticAsset(relPath: string, search: string): Promise<NextResponse> {
  const upstreamUrl = `${LOCAL_NOVNC_BASE}/${relPath}${search}`;
  try {
    const upstream = await fetch(upstreamUrl, { cache: "no-store" });
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "no-store");
    return new NextResponse(body, { status: upstream.status, headers });
  } catch (err) {
    return NextResponse.json(
      { error: `Kon noVNC niet bereiken: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
