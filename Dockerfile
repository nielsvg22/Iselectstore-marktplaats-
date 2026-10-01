# Coolify/VPS image: runs the Next.js app AND a visible Chromium session
# (Xvfb + x11vnc + noVNC) so the Marktplaats browser-test (lib/marktplaats/browserTest/)
# can be watched and logged into from a normal web browser, at
# https://<this-app>:6080/vnc.html — something Vercel's headless serverless
# functions can never provide (see MARKTPLAATS_INTEGRATION.md).
#
# This image is NOT used for the Vercel deployment — that keeps deploying
# from the same repo via Vercel's own build, unaffected by this file.

FROM node:20-bookworm-slim

# Xvfb + a minimal window manager + VNC server + noVNC web client, plus the
# OS libraries Playwright's Chromium needs (installed below via --with-deps).
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox novnc websockify \
      ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/*

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

# Downloads Chromium + the OS packages it needs at runtime.
RUN npx playwright install --with-deps chromium

RUN npm run build

# Profile dir (login session) and debug dir live on a mounted volume in
# Coolify so they survive redeploys — see MARKTPLAATS_INTEGRATION.md.
RUN mkdir -p /data/marktplaats-browser-profile /data/marktplaats-debug \
    && chown -R app:app /app /data /ms-playwright

ENV NODE_ENV=production \
    DISPLAY=:99 \
    MARKTPLAATS_BROWSER_PROFILE_DIR=/data/marktplaats-browser-profile \
    MARKTPLAATS_BROWSER_DEBUG_DIR=/data/marktplaats-debug

EXPOSE 3000 6080

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
