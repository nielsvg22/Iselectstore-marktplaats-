export const BACKEND_URL = "https://iselectstore-marktplaats-app.vercel.app";

export function toNumericId(id) {
  const raw = String(id || "").trim();
  const parts = raw.split("/");
  return parts[parts.length - 1];
}

export async function getIdToken(timeoutMs = 8000) {
  try {
    const shopify = globalThis.shopify;
    if (!shopify || !shopify.auth || typeof shopify.auth.idToken !== "function") {
      return null;
    }
    const token = await Promise.race([
      shopify.auth.idToken(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("idToken timeout")), timeoutMs)
      ),
    ]);
    return token || null;
  } catch (err) {
    return null;
  }
}

export async function callBackend(path, { method = "POST", token, body } = {}) {
  let response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(20000)
        : undefined,
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? "De iSelect-backend reageerde niet op tijd. Probeer het opnieuw."
        : "Geen verbinding met de iSelect-backend. Controleer je internetverbinding.",
      issues: [],
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        (payload && payload.error) ||
        `Verzoek mislukt (HTTP ${response.status}).`,
      issues: (payload && payload.issues) || [],
    };
  }

  return { ok: true, status: response.status, data: payload };
}

export function readFileBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + chunk)
      );
    }
    return btoa(binary);
  });
}

export async function uploadImages({ token, productId, files }) {
  const result = { added: 0, error: "" };
  for (const file of Array.from(files || [])) {
    let data;
    try {
      data = await readFileBase64(file);
    } catch (err) {
      result.error = `Kon ${file.name || "bestand"} niet lezen.`;
      break;
    }
    const res = await callBackend("/api/shopify/quick-image", {
      token,
      body: {
        productId,
        filename: file.name || "image.jpg",
        data,
      },
    });
    if (!res.ok) {
      result.error = res.error;
      break;
    }
    result.added += 1;
  }
  return result;
}
