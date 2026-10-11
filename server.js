#!/usr/bin/env node
/**
 * Custom production server.
 *
 * The ONLY reason this exists instead of plain `next start`: Next's own
 * server never listens for raw HTTP `upgrade` events, so it has no way to
 * forward the noVNC/websockify WebSocket traffic the live-browser viewer
 * needs (see app/api/marktplaats/browser-test/vnc-proxy/[...path]/route.ts
 * for the plain-HTTP half of this same proxy, and docker/entrypoint.sh for
 * where websockify itself is started — on 127.0.0.1:6080, in this same
 * container).
 *
 * Everything else behaves exactly like `next start`: this just wraps Next's
 * own request handler in a plain http.Server and adds one extra `upgrade`
 * listener next to it.
 *
 * Only used by the Coolify/Docker image (see Dockerfile and package.json's
 * "start" script). Vercel deploys from the same repo but runs its own
 * serverless infrastructure and never executes this file at all — nothing
 * here changes anything about the Vercel deployment.
 */
const { createServer } = require("node:http");
const { parse } = require("node:url");
const net = require("node:net");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

// Must match the fixed path baked into the viewer page's inline script —
// see buildViewerHtml() in vnc-proxy/[...path]/route.ts. Keep both in sync.
const VNC_WEBSOCKET_PATH = "/api/marktplaats/browser-test/vnc-proxy/websockify";
const NOVNC_WS_HOST = "127.0.0.1";
const NOVNC_WS_PORT = parseInt(process.env.MARKTPLAATS_NOVNC_WS_PORT || "6080", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      handle(req, res, parse(req.url, true));
    });

    server.on("upgrade", (req, socket, head) => {
      const { pathname } = parse(req.url || "");
      if (pathname !== VNC_WEBSOCKET_PATH) {
        socket.destroy();
        return;
      }
      proxyWebSocketUpgrade(req, socket, head);
    });

    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start custom server:", err);
    process.exit(1);
  });

/**
 * Raw TCP pass-through of one WebSocket upgrade to the local websockify
 * instance. Deliberately NOT using a library like `ws` or `http-proxy` —
 * websockify just wants to see the original HTTP Upgrade handshake
 * (method/headers) followed by the raw RFB-over-WebSocket byte stream in
 * both directions, which a plain `net.Socket` pipe gives us with no framing
 * or re-encoding at all.
 */
function proxyWebSocketUpgrade(req, socket, head) {
  const target = net.connect(NOVNC_WS_PORT, NOVNC_WS_HOST);

  target.on("error", (err) => {
    console.error("[vnc-ws-proxy] upstream connection failed:", err.message);
    socket.destroy();
  });
  socket.on("error", () => target.destroy());

  target.once("connect", () => {
    // Replay the original upgrade request line + headers, minus Host
    // (replaced with the local websockify address), so the handshake
    // websockify sees is equivalent to one a direct client would send.
    // websockify ignores the request path for its proxy target (it was
    // started with a fixed target — see docker/entrypoint.sh), so rewriting
    // the path to "/" here is safe.
    const lines = [`${req.method} / HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (name.toLowerCase() === "host") continue;
      lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    lines.push(`Host: ${NOVNC_WS_HOST}:${NOVNC_WS_PORT}`);
    lines.push("", "");
    target.write(lines.join("\r\n"));
    if (head && head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
}
