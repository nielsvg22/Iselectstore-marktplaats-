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

// De admin-extensie draait in een gesandboxte context waar File.arrayBuffer()
// onbetrouwbaar is (live bevestigd: "Kon <bestand> niet lezen") — exact
// zoals Shopify's eigen DropZone-voorbeeld het File-object dan ook nooit
// zelf uitleest, maar altijd rechtstreeks via FormData + fetch verstuurt.
// Dit doet hetzelfde: de backend leest de bytes server-side.
async function uploadImageFile({ token, productId, file }) {
  let response;
  try {
    const form = new FormData();
    form.append("productId", productId);
    form.append("file", file, file.name || "image.jpg");
    response = await fetch(`${BACKEND_URL}/api/shopify/quick-image`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(20000)
        : undefined,
    });
  } catch (err) {
    return { ok: false, error: `Kon ${file.name || "bestand"} niet uploaden.` };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }
  if (!response.ok) {
    return { ok: false, error: (payload && payload.error) || `Upload mislukt (HTTP ${response.status}).` };
  }
  return { ok: true };
}

export async function uploadImages({ token, productId, files }) {
  const result = { added: 0, error: "" };
  for (const file of Array.from(files || [])) {
    const res = await uploadImageFile({ token, productId, file });
    if (!res.ok) {
      result.error = res.error;
      break;
    }
    result.added += 1;
  }
  return result;
}

export async function previewImageFile(file) {
  const token = await getIdToken();
  if (!token) return { error: "Kon geen Shopify-sessietoken ophalen." };
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await fetch(`${BACKEND_URL}/api/shopify/quick-photo-preview`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok || !data.preview) return { error: data.error || "Het fotovoorbeeld kon niet worden geladen." };
    return { preview: data.preview };
  } catch {
    return { error: "Het fotovoorbeeld kon niet worden geladen. Probeer opnieuw." };
  }
}
