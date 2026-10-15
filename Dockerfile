# Coolify/VPS image: runs the Next.js app, OPTIONALLY alongside a visible
# Chromium session (Xvfb + x11vnc + noVNC) so the Marktplaats browser-test
# (lib/marktplaats/browserTest/) can be watched and logged into from a
# normal web browser — something Vercel's headless serverless functions can
# never provide (see MARKTPLAATS_INTEGRATION.md). This project has since
# moved to the GoedGeplaatst API integration (lib/goedgeplaatst/) as its
# primary placement route, so the browser-test is OFF BY DEFAULT here (see
# the MARKTPLAATS_BROWSER_TEST build ARG below) — its code is untouched,
# just not installed/built into the image unless explicitly re-enabled.
#
# The live view is reached through the Next.js app itself, at
# /api/marktplaats/browser-test/vnc-proxy/vnc.html?session=<token> (see that
# route + server.js), never directly at the raw noVNC/websockify port —
# that is why `npm start` now runs server.js, a thin custom server around
# Next's own request handler that ALSO forwards the live view's raw
# WebSocket (RFB) traffic to 127.0.0.1:6080, something `next start`'s server
# cannot do (it never listens for HTTP `upgrade` events). Port 6080 itself
# stays container-internal only; nothing outside needs to reach it directly
# any more.
#
# This image is NOT used for the Vercel deployment — that keeps deploying
# from the same repo via Vercel's own build, unaffected by this file (and
# never runs server.js — Vercel uses its own serverless infrastructure).

FROM node:20-bookworm-slim

# Whether to install Xvfb/x11vnc/noVNC/websockify and download Chromium at
# all — the slowest, heaviest parts of this image. This project has moved
# to the GoedGeplaatst API integration (lib/goedgeplaatst/) as its primary
# placement route; the Playwright browser-test is unused for now and its
# own code is untouched, just not built into the image by default. Set
# MARKTPLAATS_BROWSER_TEST=true as a Coolify BUILD-time variable (not just
# a runtime one) to bring this back — docker/entrypoint.sh already checks
# the same flag at runtime, so both sides need to agree.
ARG MARKTPLAATS_BROWSER_TEST=false

# Xvfb + a minimal window manager + VNC server + noVNC web client — only
# when the browser-test is actually enabled. ca-certificates/curl/gosu are
# needed either way (gosu for running the app as non-root, see entrypoint.sh).
RUN if [ "$MARKTPLAATS_BROWSER_TEST" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        xvfb x11vnc fluxbox novnc websockify \
        ca-certificates curl gosu \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gosu \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Non-root user: Chromium's own sandbox requires not running as root (the
# alternative, --no-sandbox, weakens Chromium's security — avoided instead
# of changing lib/marktplaats/browserTest/browserTestPublisher.ts's launch args).
RUN useradd --create-home --shell /bin/bash app

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Fixed, non-$HOME browser location: this is installed while still root, but
# the app actually runs as the non-root `app` user (via gosu, see
# entrypoint.sh) — without this, Playwright installs to /root/.cache and the
# app user later looks in /home/app/.cache and finds nothing.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Downloads Chromium + the OS packages it needs at runtime — only when
# enabled (see the ARG above). Falls back to the npmmirror.com mirror when
# the primary cdn.playwright.dev CDN geo-blocks the build host (seen as a
# 403 "not available in your location" on this VPS). The `playwright` npm
# package itself is still installed via `npm ci` either way (it's a normal
# package.json dependency, needed for the code to type-check/build) — this
# step only downloads the actual browser binary, which the build itself
# never needs.
RUN if [ "$MARKTPLAATS_BROWSER_TEST" = "true" ]; then \
      npx playwright install --with-deps chromium \
      || PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright npx playwright install --with-deps chromium; \
    else \
      echo "MARKTPLAATS_BROWSER_TEST != true — skipping Chromium download."; \
    fi

RUN npm run build

# Profile dir (login session) and debug dir live on a mounted volume in
# Coolify so they survive redeploys — see MARKTPLAATS_INTEGRATION.md.
# /ms-playwright is created here unconditionally (not just by the Chromium
# download step above) because `chown` fails outright on a path that
# doesn't exist yet — when MARKTPLAATS_BROWSER_TEST=false skips that
# download, the directory would otherwise never get created and broke the
# build here. Harmless empty directory when unused.
RUN mkdir -p /data/marktplaats-browser-profile /data/marktplaats-debug /ms-playwright \
    && chown -R app:app /app /data /ms-playwright

ENV NODE_ENV=production \
    DISPLAY=:99 \
    MARKTPLAATS_BROWSER_PROFILE_DIR=/data/marktplaats-browser-profile \
    MARKTPLAATS_BROWSER_DEBUG_DIR=/data/marktplaats-debug

# 6080 is kept exposed for debugging direct access to websockify from
# inside Coolify's network if ever needed, but the app itself never needs
# it published publicly any more — see the vnc-proxy route above.
EXPOSE 3000 6080

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
