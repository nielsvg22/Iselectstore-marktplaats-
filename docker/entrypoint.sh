#!/bin/bash
# Starts a virtual display + VNC + noVNC (so a human can watch/log into the
# real, visible Chromium session from a browser), then the Next.js app.
# Runs everything as the non-root `app` user via gosu (see Dockerfile).
set -euo pipefail

mkdir -p /data/marktplaats-browser-profile /data/marktplaats-debug
chown -R app:app /data

# MARKTPLAATS_BROWSER_TEST=false (the same flag that gates the Playwright
# bot's API routes, see lib/marktplaats/browserTest/config.ts) also skips
# starting the VM here — the Playwright code itself is untouched, this only
# stops Xvfb/x11vnc/websockify from spinning up on every deploy while the
# browser-test feature isn't being used. Set it back to true (and keep
# VNC_PASSWORD set) to re-enable the live viewer.
if [ "${MARKTPLAATS_BROWSER_TEST:-false}" = "true" ]; then
  if [ -z "${VNC_PASSWORD:-}" ]; then
    echo "FATAL: VNC_PASSWORD is not set. Refusing to start the noVNC session" \
         "unauthenticated — anyone with the URL could watch/control a real," \
         "logged-in Marktplaats session. Set VNC_PASSWORD in Coolify's" \
         "environment variables and redeploy." >&2
    exit 1
  fi

  mkdir -p /home/app/.vnc
  chown -R app:app /home/app/.vnc

  # VNC auth (x11vnc's own challenge, independent of anything in front of it).
  gosu app x11vnc -storepasswd "$VNC_PASSWORD" /home/app/.vnc/passwd

  gosu app Xvfb "$DISPLAY" -screen 0 1600x1000x24 &
  XVFB_PID=$!

  # Give Xvfb a moment to create its socket before anything tries to use it.
  for i in $(seq 1 20); do
    if [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; then break; fi
    sleep 0.25
  done

  gosu app fluxbox &

  gosu app x11vnc -display "$DISPLAY" -forever -shared -rfbauth /home/app/.vnc/passwd -rfbport 5900 -quiet &

  # noVNC web client, listening on 6080, loopback-reachable from the Next.js
  # app started below (server.js proxies both the plain HTTP static files and
  # the raw WebSocket/RFB traffic to 127.0.0.1:6080 — see
  # app/api/marktplaats/browser-test/vnc-proxy/[...path]/route.ts). Port 6080
  # no longer needs to be reachable from outside this container at all.
  websockify --web /usr/share/novnc 6080 localhost:5900 &

  cleanup() {
    kill "$XVFB_PID" 2>/dev/null || true
  }
  trap cleanup EXIT
else
  echo "MARKTPLAATS_BROWSER_TEST is not 'true' — skipping Xvfb/x11vnc/websockify startup." \
       "The Playwright browser-test feature is unused for now; its code and API routes" \
       "are untouched, just not started. Set MARKTPLAATS_BROWSER_TEST=true to re-enable."
fi

# `npm start` now runs server.js (a thin wrapper around Next's own request
# handler) instead of `next start` — the only difference is it also forwards
# the live view's WebSocket traffic to websockify above when running. See
# server.js (the upgrade listener there simply never matches anything when
# no local websockify is listening on 6080, which is harmless).
exec gosu app npm start
