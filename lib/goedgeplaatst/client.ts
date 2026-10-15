// Server-side REST client for the official GoedGeplaatst API
// (docs.goedgeplaatst.nl/api/rest/v1/). This is the ONLY module in this
// feature allowed to call `fetch` against api.goedgeplaatst.nl /
// dev-api.goedgeplaatst.nl — every other module goes through here (or
// mock.ts) so the rate limit, timeout, retry and logging rules apply
// uniformly, and so assertEndpointAllowed() cannot be bypassed.
//
// Auth header: per docs.goedgeplaatst.nl/api/rest/v1/authentication/ every
// request carries a header literally named `Authentication` (NOT the usual
// `Authorization`) whose value is the pre-shared API key. This looks like a
// typo but is intentional on GoedGeplaatst's side — do not "fix" it.
//
// Response envelope: every endpoint answers `{ result, errors, data }`.
// There is no documented HTTP-status convention for errors, so all error
// handling here keys off `result`/`errors`, with HTTP status only used as a
// secondary signal (network/transport failures, 429 for backoff).

import { assertEndpointAllowed, getGoedgeplaatstConfig, RATE_LIMIT } from "./config";
import { GoedgeplaatstEnvelope } from "./types";

export class GoedgeplaatstApiError extends Error {
  constructor(message: string, public httpStatus?: number, public errors?: unknown[]) {
    super(message);
    this.name = "GoedgeplaatstApiError";
  }
}

export class GoedgeplaatstConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoedgeplaatstConfigError";
  }
}

// --- Rate limiting: token bucket, 3 req/s sustained, burst 10 (per docs). ---
// Module-level singleton: correct for a single Node process. On 429 we also
// back off (see requestOnce) regardless of the local bucket, since a shared
// deployment or clock drift could still exceed the remote limit.
let tokens = RATE_LIMIT.burst;
let lastRefillMs = Date.now();

function refill() {
  const now = Date.now();
  const elapsedSeconds = (now - lastRefillMs) / 1000;
  tokens = Math.min(RATE_LIMIT.burst, tokens + elapsedSeconds * RATE_LIMIT.sustainedPerSecond);
  lastRefillMs = now;
}

async function acquireToken(): Promise<void> {
  for (;;) {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - tokens) / RATE_LIMIT.sustainedPerSecond * 1000);
    await sleep(Math.max(waitMs, 25));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Never logs the API key or any request/response body — only method+path+outcome. */
function logRequest(method: string, path: string, outcome: string) {
  // eslint-disable-next-line no-console
  console.log(`[goedgeplaatst] ${method} ${path} -> ${outcome}`);
}

const MAX_RETRIES = 3;

async function requestOnce<T>(method: string, path: string, body?: unknown): Promise<GoedgeplaatstEnvelope<T>> {
  const config = getGoedgeplaatstConfig();
  if (!config.apiKey) {
    throw new GoedgeplaatstConfigError("GOEDGEPLAATST_API_KEY ontbreekt — gebruik de mock-modus of stel de sleutel in.");
  }
  assertEndpointAllowed(path);

  const url = `${config.baseUrl}${path.replace(/^\//, "")}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await acquireToken();
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method,
          headers: {
            // Intentional: GoedGeplaatst's own header name, not Authorization. See file header.
            Authentication: config.apiKey,
            "Content-Type": "application/json",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        config.requestTimeoutMs
      );
    } catch (err) {
      logRequest(method, path, `network-error (attempt ${attempt})`);
      if (attempt === MAX_RETRIES) {
        throw new GoedgeplaatstApiError(`Kon GoedGeplaatst niet bereiken (netwerkfout/timeout): ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(250 * attempt);
      continue;
    }

    if (res.status === 429) {
      logRequest(method, path, `429 rate limited (attempt ${attempt})`);
      if (attempt === MAX_RETRIES) {
        throw new GoedgeplaatstApiError("GoedGeplaatst rate limit overschreden (HTTP 429) — probeer het later opnieuw.", 429);
      }
      await sleep(400 * attempt);
      continue;
    }

    let json: GoedgeplaatstEnvelope<T> | null = null;
    try {
      json = (await res.json()) as GoedgeplaatstEnvelope<T>;
    } catch {
      // fall through — handled below as a malformed response
    }

    if (!json || typeof json.result !== "boolean") {
      logRequest(method, path, `malformed-response (http ${res.status})`);
      throw new GoedgeplaatstApiError(`Onverwacht antwoord van GoedGeplaatst (HTTP ${res.status}) — geen geldige result/errors/data-envelope.`, res.status);
    }

    if (!json.result) {
      logRequest(method, path, `result=false (http ${res.status})`);
      throw new GoedgeplaatstApiError(summarizeErrors(json.errors), res.status, json.errors);
    }

    logRequest(method, path, `ok (http ${res.status})`);
    return json;
  }

  // Unreachable, but keeps TypeScript happy.
  throw new GoedgeplaatstApiError("Onbekende fout bij GoedGeplaatst-aanroep.");
}

function summarizeErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return "GoedGeplaatst meldde een fout zonder details.";
  return errors
    .map((e) => {
      if (e && typeof e === "object") {
        const anyE = e as Record<string, unknown>;
        return [anyE.field, anyE.message ?? anyE.code].filter(Boolean).join(": ");
      }
      return String(e);
    })
    .filter(Boolean)
    .join("; ");
}

export async function goedgeplaatstRequest<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const envelope = await requestOnce<T>(method, path, body);
  return envelope.data;
}
