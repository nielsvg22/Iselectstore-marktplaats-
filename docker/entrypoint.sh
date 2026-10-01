#!/bin/bash
# Starts a virtual display + VNC + noVNC (so a human can watch/log into the
# real, visible Chromium session from a browser), then the Next.js app.
# Runs everything as the non-root `app` user via gosu (see Dockerfile).
set -euo pipefail

if [ -z "${VNC_PASSWORD:-}" ]; then
  echo "FATAL: VNC_PASSWORD is not set. Refusing to start the noVNC session" \
       "unauthenticated — anyone with the URL could watch/control a real," \
       "logged-in Marktplaats session. Set VNC_PASSWORD in Coolify's" \
       "environment variables and redeploy." >&2
  exit 1
fi

mkdir -p /data/marktplaats-browser-profile /data/marktplaats-debug /home/app/.vnc
chown -R app:app /data /home/app/.vnc

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

# noVNC web client, proxied over plain HTTP on 6080 — put a TLS-terminating
# reverse proxy (Coolify's own domain/Traefik) in front of this in production.
websockify --web /usr/share/novnc 6080 localhost:5900 &

cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

exec gosu app npm start
