"use client";

import { useEffect, useState } from "react";
import { AIRecognitionPanel } from "../AIRecognitionPanel";
import { GOEDGEPLAATST_CATEGORY_MAP } from "@/lib/goedgeplaatst/categoryMap";

type CheckStatus = "ok" | "warning" | "error";

interface ValidationCheck {
  label: string;
  status: CheckStatus;
  detail?: string;
}

type BrowserFieldStatusKind = "ok" | "warning" | "error" | "info";

interface BrowserFieldStatus {
  field: string;
  status: BrowserFieldStatusKind;
  detail?: string;
}

interface StepTiming {
  step: string;
  ms: number;
}

interface BrowserTestRun {
  runId: string;
  shopifyProductId: string;
  state: "queued" | "waiting_login" | "waiting_code" | "verifying_code" | "authenticated" | "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  title?: string;
  message?: string;
  stoppedBeforeSubmit: boolean;
  postedUrl?: string;
  statuses: BrowserFieldStatus[];
  timings?: StepTiming[];
  codeAttempts?: number;
}

interface BrowserTestConfig {
  enabled: boolean;
  allowSubmit: boolean;
  apiConfigured: boolean;
  placementUrl: string;
  profileDir: string;
  // novncPassword is deliberately absent: the server never sends the noVNC
  // password to the browser (see app/api/marktplaats/browser-test/route.ts
  // — part 4 of the assignment, the old query-string leak).
  novncUrl: string | null;
}

interface AttributeMappingResult {
  internalField: string;
  label: string;
  shopifyValue: string;
  marktplaatsAttributeKey: string | null;
  marktplaatsValue: string | number | null;
  status: string;
  note?: string;
}

interface ProductPreview {
  shopifyTitle: string;
  marktplaatsTitle: string;
  marktplaatsDescription: string;
  productType: string;
  categoryMapping: { l1CategoryName: string; l2CategoryName: string } | null;
  mappingSource: "mock" | "cache" | "live";
  attributeResults: AttributeMappingResult[];
  validation: { checks: ValidationCheck[]; publishable: boolean };
  imageUrls: string[];
  payloadPreview: { priceModel: { askingPrice?: number } };
}

const statusIcon: Record<CheckStatus, string> = { ok: "✅", warning: "⚠", error: "❌" };
const attrStatusIcon: Record<string, string> = {
  mapped: "✅",
  missing_value: "—",
  no_matching_attribute: "⚠",
  not_writable: "⚠",
  value_not_allowed: "❌",
};

const browserStatusIcon: Record<BrowserFieldStatusKind, string> = {
  ok: "✓",
  warning: "⚠",
  error: "✗",
  info: "ℹ",
};

// Part 6 of the assignment: duidelijke, losse statussen in plaats van de
// ruwe state-machine-waarden. "Code verstuurd" mag nooit als succesvolle
// login getoond worden — er is geen state-waarde die dat zegt, "authenticated"
// (pas bereikt na bevestiging door Marktplaats zelf) is de enige die
// "Succesvol ingelogd" mag tonen.
const browserStateLabel: Record<BrowserTestRun["state"], string> = {
  queued: "Browser verbinden",
  waiting_login: "Wachten op login",
  waiting_code: "Wachten op verificatiecode",
  verifying_code: "Code controleren…",
  authenticated: "Succesvol ingelogd",
  running: "Advertentie voorbereiden",
  done: "Klaar",
  failed: "Mislukt",
};

interface GoedgeplaatstCategoryOption {
  categoryId: number;
  label: string;
}

interface GoedgeplaatstLinkRow {
  link_key: string;
  goedgeplaatst_ad_id: string | null;
  concept_status: string;
  mock: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

interface GoedgeplaatstAttributeStatus {
  key: string;
  label: string;
  mandatory: boolean;
  value: string | number | null;
  source: string;
}

interface GoedgeplaatstCreateResult {
  mock: boolean;
  reused: boolean;
  adId: number;
  imagesAdded: number;
  missingMandatory: string[];
  attributeStatuses: GoedgeplaatstAttributeStatus[];
}

interface GoedgeplaatstAttributeDiff {
  confirmed: { key: string; label: string; value: string | number }[];
  missing: { key: string; label: string; sentValue: string | number }[];
  mismatched: { key: string; label: string; sentValue: string | number; returnedValue: string | number }[];
}

interface GoedgeplaatstVerifyResult {
  mock: boolean;
  found: boolean;
  message: string;
  attributeDiff: GoedgeplaatstAttributeDiff | null;
}

interface GoedgeplaatstAttributeDefinition {
  key: string;
  label: string;
  mandatory: boolean;
  writable: boolean;
  values?: { value: string; label?: string }[];
}

/**
 * Second, NAAST-ELKAAR-BESTAANDE plaatsingsoptie (STAP 8) — de officiële
 * GoedGeplaatst REST API, los van de bestaande Playwright-test hierboven.
 * Hergebruikt dezelfde /api/marktplaats/test-mapping preview (title/
 * description/price/images komen uit orchestrator.buildProductPreview) in
 * plaats van een eigen Shopify-ophaal-laag.
 */
function GoedgeplaatstSection({ shopifyProductId, productType }: { shopifyProductId: string; productType: string }) {
  const [categories, setCategories] = useState<{ groups: { categories: { categoryId: number; descriptions: { description: string }[] }[] }[]; mock: boolean } | null>(null);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [categoryAutoPicked, setCategoryAutoPicked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoedgeplaatstCreateResult | null>(null);
  const [link, setLink] = useState<GoedgeplaatstLinkRow | null>(null);
  const [attributes, setAttributes] = useState<GoedgeplaatstAttributeDefinition[]>([]);
  const [delivery, setDelivery] = useState("");
  const [ean, setEan] = useState("");
  const [verifyResult, setVerifyResult] = useState<GoedgeplaatstVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetch("/api/goedgeplaatst/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCategories(data);
        // Pre-select the category for this Shopify product's type (see
        // lib/goedgeplaatst/categoryMap.ts) so this is a one-click action
        // instead of a manual dropdown pick every time — only when the
        // mapped id is actually present in the live/mock category list.
        const mapped = GOEDGEPLAATST_CATEGORY_MAP[productType];
        if (mapped !== undefined) {
          const exists = (data.groups ?? []).some((g: { categories: { categoryId: number }[] }) => g.categories.some((c) => c.categoryId === mapped));
          if (exists) {
            setCategoryId(mapped);
            setCategoryAutoPicked(true);
          }
        }
      })
      .catch(() => {});
    fetch(`/api/goedgeplaatst/link?shopifyProductId=${encodeURIComponent(shopifyProductId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setLink(data.link))
      .catch(() => {});
  }, [shopifyProductId, productType]);

  // Fetches the live/mock attribute list for the (auto-picked or manually
  // chosen) category, purely to populate the "Levering" invulveld's options
  // with GoedGeplaatst's own enum — never a hand-typed/invented list.
  useEffect(() => {
    if (categoryId === "") {
      setAttributes([]);
      return;
    }
    fetch("/api/goedgeplaatst/attributes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setAttributes((data.categoryAttributes?.attributes ?? []).flatMap((a: { attributes: GoedgeplaatstAttributeDefinition[] }) => a.attributes));
      })
      .catch(() => {});
  }, [categoryId]);

  const options: GoedgeplaatstCategoryOption[] = (categories?.groups ?? []).flatMap((g) =>
    g.categories.map((c) => ({ categoryId: c.categoryId, label: c.descriptions?.[0]?.description ?? String(c.categoryId) }))
  );

  async function createViaGoedgeplaatst(force = false) {
    if (categoryId === "") {
      setError("Kies eerst een GoedGeplaatst-categorie.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/goedgeplaatst/create-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
        body: JSON.stringify({
          idempotencyKey: `shopify-${shopifyProductId}`,
          categoryId,
          shopifyProductId,
          force,
          delivery: delivery || undefined,
          ean: ean || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setResult(data.result);
      // "Opnieuw posten" replaces the stored link with the new adId — refresh
      // it so the status line reflects the new ad, not the deleted one.
      if (force) {
        fetch(`/api/goedgeplaatst/link?shopifyProductId=${encodeURIComponent(shopifyProductId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setLink(d.link))
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /** STAP 7/8: GET /ads/ via onze eigen verify-route, vergeleken met wat we hebben verstuurd. */
  async function verifyViaGoedgeplaatst() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/goedgeplaatst/verify?linkKey=${encodeURIComponent(`shopify:${shopifyProductId}`)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setVerifyResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  const alreadyLinked = Boolean(link?.goedgeplaatst_ad_id);
  const deliveryAttr = attributes.find((a) => a.key === "delivery");
  const eanAttr = attributes.find((a) => a.key === "ean");

  return (
    <div style={{ ...cardStyle(), borderStyle: "dashed" }}>
      <h3 style={{ marginTop: 0 }}>
        GoedGeplaatst API {categories?.mock && <span style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", background: "#fff7ed", borderRadius: 999, padding: "1px 8px", marginLeft: 6 }}>mock</span>}
      </h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: -6 }}>
        Tweede plaatsingsmethode (los van de Playwright-test hierboven) — slaat uitsluitend een concept op via de officiële GoedGeplaatst
        REST API. Titel/omschrijving/prijs/afbeeldingen komen automatisch uit Shopify.
      </p>

      {alreadyLinked ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 14, color: "#16a34a", marginBottom: 8 }}>
            ✅ Al gekoppeld — GoedGeplaatst adId <code>{link!.goedgeplaatst_ad_id}</code> ({link!.concept_status}
            {link!.mock ? ", mock" : ""}).
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="password"
              placeholder="Admin-wachtwoord"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
            />
            <button onClick={() => createViaGoedgeplaatst(true)} disabled={loading} style={btnStyle()}>
              {loading ? "Bezig…" : "Opnieuw posten"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, marginBottom: 0 }}>
            Voor als je de concept-advertentie in GoedGeplaatst hebt verwijderd en dit product nogmaals wilt testen — maakt een NIEUWE advertentie aan en
            vervangt de koppeling hierboven.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(Number(e.target.value));
                setCategoryAutoPicked(false);
              }}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
            >
              <option value="" disabled>
                Kies GoedGeplaatst-categorie…
              </option>
              {options.map((o) => (
                <option key={o.categoryId} value={o.categoryId}>
                  {o.label}
                </option>
              ))}
            </select>
            {categoryAutoPicked && (
              <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2 }}>✓ Automatisch gekozen op basis van producttype &quot;{productType}&quot; — kan handmatig gewijzigd worden.</div>
            )}
          </div>
          <input
            type="password"
            placeholder="Admin-wachtwoord"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
          />
        </div>
      )}

      {!alreadyLinked && (deliveryAttr || eanAttr) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
          {deliveryAttr && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#374151" }}>
              Levering (geen Shopify-brondata — handmatig){" "}
              <select value={delivery} onChange={(e) => setDelivery(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}>
                <option value="">— niet opgeven —</option>
                {(deliveryAttr.values ?? []).map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label ?? v.value}
                  </option>
                ))}
              </select>
            </label>
          )}
          {eanAttr && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#374151" }}>
              EAN (optioneel — alleen als Shopify geen barcode heeft)
              <input
                value={ean}
                onChange={(e) => setEan(e.target.value)}
                placeholder="bijv. 0194253715816"
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>
          )}
        </div>
      )}

      {!alreadyLinked && (
        <button onClick={() => createViaGoedgeplaatst(false)} disabled={loading} style={btnStyle()}>
          {loading ? "Bezig…" : "Opslaan als concept via GoedGeplaatst"}
        </button>
      )}

      {error && <div style={{ marginTop: 10, color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 10, fontSize: 14 }}>
          {result.mock && <div style={{ fontWeight: 700, color: "#9a3412" }}>🧪 GESIMULEERD (mock)</div>}
          Concept {result.reused ? "hergebruikt" : "aangemaakt"} — adId <code>{result.adId}</code>, {result.imagesAdded} afbeelding(en).
          {result.attributeStatuses?.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 13, color: "#374151" }}>
              {result.attributeStatuses.map((s) => (
                <li key={s.key}>
                  {s.value !== null ? "✅" : s.mandatory ? "❌" : "—"} {s.label}: {s.value !== null ? `${s.value} (${s.source})` : "leeg"}
                </li>
              ))}
            </ul>
          )}
          {result.missingMandatory.length > 0 && (
            <div style={{ marginTop: 6, color: "#dc2626", fontWeight: 600 }}>Ontbrekende verplichte kenmerken: {result.missingMandatory.join(", ")}</div>
          )}
        </div>
      )}

      {(alreadyLinked || result) && (
        <div style={{ marginTop: 10 }}>
          <button onClick={verifyViaGoedgeplaatst} disabled={verifying} style={btnStyle()}>
            {verifying ? "Bezig…" : "Controleren via GET /ads/"}
          </button>
          {verifyResult && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: verifyResult.found ? "#16a34a" : "#dc2626" }}>
                {verifyResult.mock && <span style={{ color: "#9a3412" }}>🧪 GESIMULEERD (mock) — </span>}
                {verifyResult.message}
              </div>
              {verifyResult.attributeDiff && (
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", color: "#374151" }}>
                  {verifyResult.attributeDiff.confirmed.map((c) => (
                    <li key={c.key} style={{ color: "#16a34a" }}>✅ {c.label}: {c.value} — bevestigd opgeslagen</li>
                  ))}
                  {verifyResult.attributeDiff.mismatched.map((m) => (
                    <li key={m.key} style={{ color: "#b45309" }}>⚠ {m.label}: verstuurd &quot;{m.sentValue}&quot;, teruggekregen &quot;{m.returnedValue}&quot;</li>
                  ))}
                  {verifyResult.attributeDiff.missing.map((m) => (
                    <li key={m.key} style={{ color: "#dc2626" }}>❌ {m.label}: verstuurd &quot;{m.sentValue}&quot;, niet terug in GET /ads/</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MarktplaatsPanel({ shopifyProductId, productType }: { shopifyProductId: string; productType: string }) {
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [fullTestResult, setFullTestResult] = useState<{ passed: boolean; steps: { label: string; ok: boolean; detail?: string }[]; mock: boolean } | null>(null);
  const [publishResult, setPublishResult] = useState<{ advertisementId: string; mock: boolean } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdPreview, setShowAdPreview] = useState(false);
  // Still fetched — browserConfig.apiConfigured gates the "Publiceren via
  // API" button below, which goes through the official Marktplaats API
  // client (lib/marktplaats/apiPublisher.ts), NOT the Playwright bot. The
  // Playwright/noVNC browser-test UI itself (button, live viewer, run
  // polling) has been removed from this panel — that route is unused for
  // now (see docker/entrypoint.sh / MARKTPLAATS_BROWSER_TEST=false); the
  // backend code is untouched, just not driven from here anymore.
  const [browserConfig, setBrowserConfig] = useState<BrowserTestConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marktplaats/browser-test")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBrowserConfig(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function call(url: string, key: string) {
    setLoading(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyProductId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(null);
    }
  }

  async function testMapping() {
    const data = await call("/api/marktplaats/test-mapping", "test");
    if (data) setPreview(data.preview);
  }

  async function showAdPreviewCard() {
    if (!preview) {
      const data = await call("/api/marktplaats/test-mapping", "adpreview");
      if (data) setPreview(data.preview);
      else return;
    }
    setShowAdPreview(true);
  }

  async function showPayload() {
    const data = await call("/api/marktplaats/payload", "payload");
    if (data) setPayload(data.payload);
  }

  async function fullApiTest() {
    const data = await call("/api/marktplaats/full-test", "fulltest");
    if (data) setFullTestResult(data.result);
  }

  async function publish() {
    if (!confirm("Weet je zeker dat je dit product wilt publiceren op Marktplaats?")) return;
    const data = await call("/api/marktplaats/publish", "publish");
    if (data) setPublishResult(data.result);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {productType && <AIRecognitionPanel shopifyProductId={shopifyProductId} productType={productType} />}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={testMapping} disabled={loading !== null} style={btnStyle()}>
          {loading === "test" ? "Bezig…" : "Test Marktplaats mapping"}
        </button>
        <button onClick={showPayload} disabled={loading !== null} style={btnStyle()}>
          {loading === "payload" ? "Bezig…" : "Toon Marktplaats payload"}
        </button>
        <button onClick={showAdPreviewCard} disabled={loading !== null} style={btnStyle()}>
          {loading === "adpreview" ? "Bezig…" : "Voorbeeld advertentie"}
        </button>
        <button onClick={fullApiTest} disabled={loading !== null} style={btnStyle()}>
          {loading === "fulltest" ? "Bezig…" : "Volledige Marktplaats API-test"}
        </button>
        <button
          onClick={publish}
          disabled={loading !== null || browserConfig?.apiConfigured === false || (preview ? !preview.validation.publishable : false)}
          title={browserConfig?.apiConfigured === false ? "Geen Marktplaats API-configuratie gevonden." : undefined}
          style={btnStyle(true)}
        >
          {loading === "publish" ? "Bezig…" : "Publiceren via API"}
        </button>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, color: "#991b1b" }}>{error}</div>}

      {preview && showAdPreview && <MarktplaatsAdPreview preview={preview} />}

      {preview && (
        <div style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>Kenmerken ({preview.mappingSource === "mock" ? "mock-attributen" : preview.mappingSource})</h3>
          <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>
            Categorie: {preview.categoryMapping ? `${preview.categoryMapping.l1CategoryName} > ${preview.categoryMapping.l2CategoryName}` : "geen mapping"}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {preview.attributeResults.map((r) => (
              <li key={r.internalField} style={{ padding: "4px 0", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
                {attrStatusIcon[r.status] ?? "•"} <b>{r.label}</b>: {r.shopifyValue || "—"}
                {r.marktplaatsAttributeKey ? ` → ${r.marktplaatsAttributeKey} (${r.marktplaatsValue})` : ""}
                {r.note && <span style={{ color: "#92400e", marginLeft: 6 }}>— {r.note}</span>}
              </li>
            ))}
          </ul>

          <h3>Marktplaats titel</h3>
          <div style={{ fontFamily: "monospace", background: "#f7f7f7", padding: 10, borderRadius: 8 }}>{preview.marktplaatsTitle}</div>

          <h3>Marktplaats beschrijving</h3>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 10, borderRadius: 8, fontFamily: "inherit", fontSize: 14 }}>{preview.marktplaatsDescription}</pre>

          <h3>Preflight validatie</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {preview.validation.checks.map((c, i) => (
              <li key={i} style={{ padding: "4px 0", fontSize: 14 }}>
                {statusIcon[c.status]} {c.label}
                {c.detail ? `: ${c.detail}` : ""}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 8, fontWeight: 700, color: preview.validation.publishable ? "#16a34a" : "#dc2626" }}>
            Publiceerbaarheid: {preview.validation.publishable ? "✅ klaar" : "❌ nog niet"}
          </div>
        </div>
      )}

      {payload !== null && (
        <div style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>Raw Marktplaats payload</h3>
          <pre style={{ whiteSpace: "pre-wrap", background: "#0b1220", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 13, overflowX: "auto" }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}

      {fullTestResult && (
        <div style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>FULL MARKTPLAATS API TEST {fullTestResult.mock ? "(mock)" : ""}</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {fullTestResult.steps.map((s, i) => (
              <li key={i} style={{ padding: "4px 0", fontSize: 14 }}>
                {s.ok ? "✅" : "❌"} {s.label}
                {s.detail ? `: ${s.detail}` : ""}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 8, fontWeight: 700, color: fullTestResult.passed ? "#16a34a" : "#dc2626" }}>RESULTAAT: {fullTestResult.passed ? "PASSED" : "FAILED"}</div>
        </div>
      )}

      {publishResult && (
        <div style={{ ...cardStyle(), borderColor: "#16a34a" }}>
          ✅ Gepubliceerd{publishResult.mock ? " (mock)" : ""} — advertentie-ID: <code>{publishResult.advertisementId}</code>
        </div>
      )}

      <GoedgeplaatstSection shopifyProductId={shopifyProductId} productType={productType} />
    </div>
  );
}

function formatPrice(cents: number | undefined): string {
  if (!cents && cents !== 0) return "";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents);
}

/**
 * Live debug view of the local Playwright test: which field was filled, which
 * selector matched and which field Marktplaats did not offer.
 */
function BrowserTestStatusCard({ run, novncUrl }: { run: BrowserTestRun; novncUrl: string | null }) {
  const isActive =
    run.state === "queued" ||
    run.state === "running" ||
    run.state === "waiting_login" ||
    run.state === "waiting_code" ||
    run.state === "verifying_code" ||
    run.state === "authenticated";
  const accent = run.state === "failed" ? "#dc2626" : isActive ? "#b45309" : "#16a34a";
  // Part 3 of the assignment: the live view now stays visible during EVERY
  // phase (connecting, inloggen, MFA, formulier invullen, uploaden,
  // publiceren, foutafhandeling) — it is never hidden any more. The original
  // problem this used to "solve" by hiding the iframe (noVNC grabbing
  // keyboard focus away from our own login/code inputs, especially on
  // mobile) is instead solved below with `manualControl`: by default the
  // iframe is rendered `pointer-events: none` (and non-focusable) during
  // waiting_login/waiting_code so it cannot steal clicks/typing from those
  // fields, with an explicit "Browser handmatig bedienen" toggle to make it
  // interactive again when someone actually wants to click around inside
  // the live VM themselves (e.g. to resolve a Marktplaats challenge the
  // automated flow doesn't recognize).
  const showViewer = Boolean(novncUrl);
  const typingNow = run.state === "waiting_login" || run.state === "waiting_code";
  const [manualControl, setManualControl] = useState(false);
  const viewerInteractive = manualControl || !typingNow;
  // Live-viewer session token (see app/api/marktplaats/browser-test/
  // vnc-session/route.ts). The iframe never loads the raw noVNC URL any
  // more — it loads our own vnc-proxy route, which only serves the viewer
  // page (with the real VNC_PASSWORD injected into its BODY, never its
  // URL) once this one-time, 60s token is presented and validated
  // server-side. See vnc-proxy/[...path]/route.ts for the full explanation.
  const [vncToken, setVncToken] = useState<string | null>(null);
  const [vncError, setVncError] = useState<string | null>(null);
  const [vncLoading, setVncLoading] = useState(false);
  const [vncRetryNonce, setVncRetryNonce] = useState(0);

  useEffect(() => {
    if (!showViewer) return;
    let cancelled = false;
    setVncToken(null);
    setVncError(null);
    setVncLoading(true);
    fetch("/api/marktplaats/browser-test/vnc-session", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error || "Kon geen live sessie starten.");
        }
        return res.json() as Promise<{ token: string }>;
      })
      .then((data) => {
        if (!cancelled) setVncToken(data.token);
      })
      .catch((err) => {
        if (!cancelled) setVncError(err instanceof Error ? err.message : "Live weergave niet beschikbaar.");
      })
      .finally(() => {
        if (!cancelled) setVncLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // run.runId: fetch a fresh token once per run, not on every status poll.
    // vncRetryNonce: lets the "Opnieuw proberen" button force a refetch.
  }, [showViewer, run.runId, vncRetryNonce]);

  function retryVncSession() {
    setVncError(null);
    setVncRetryNonce((n) => n + 1);
  }

  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submitLogin() {
    if (!loginUsername.trim() || !loginPassword) return;
    setLoginStatus("sending");
    try {
      const res = await fetch("/api/marktplaats/browser-test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.runId, username: loginUsername, password: loginPassword }),
      });
      if (!res.ok) throw new Error();
      setLoginStatus("sent");
      setLoginPassword("");
    } catch {
      setLoginStatus("error");
    }
  }

  async function submitCode() {
    if (!code.trim()) return;
    setCodeStatus("sending");
    try {
      const res = await fetch("/api/marktplaats/browser-test/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.runId, code }),
      });
      if (!res.ok) throw new Error();
      setCodeStatus("sent");
      setCode("");
    } catch {
      setCodeStatus("error");
    }
  }

  // Vertical, mobile-first layout (part 3/6): live beeld boven, dan status,
  // dan het MFA-invoerveld (altijd bereikbaar/typbaar — nooit meer als
  // fullscreen pop-up die de rest van het scherm blokkeert), dan voortgang,
  // dan foutmeldingen/resultaat.
  return (
    <div style={{ ...cardStyle(), borderColor: accent }}>
      <h3 style={{ marginTop: 0 }}>
        Test op Marktplaats{run.title ? ` — ${run.title}` : ""}{" "}
        <span style={{ fontSize: 13, fontWeight: 400, color: "#6b7280" }}>
          · {browserStateLabel[run.state]}
          {isActive ? "…" : ""}
        </span>
      </h3>

      {showViewer && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: "#6b7280" }}>Live browser:</div>
            <button
              onClick={() => setManualControl((v) => !v)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid " + (manualControl ? "#b45309" : "#d1d5db"),
                background: manualControl ? "#fffbeb" : "#f9fafb",
                color: manualControl ? "#92400e" : "#374151",
                cursor: "pointer",
              }}
              title={typingNow ? "Schakel in om zelf in de live browser te klikken/typen in plaats van in het veld hieronder" : "Schakel in om zelf in de live browser te klikken/typen"}
            >
              {manualControl ? "✓ Browser handmatig bedienen" : "Browser handmatig bedienen"}
            </button>
          </div>
          {typingNow && !manualControl && (
            <div style={{ fontSize: 12, color: "#92400e", marginBottom: 6 }}>
              Beeld is zichtbaar maar niet klikbaar, zodat je typen hieronder niet per ongeluk in de verkeerde plek terechtkomt. Zet &quot;Browser handmatig bedienen&quot; aan om er zelf in te werken.
            </div>
          )}
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", borderRadius: 10, overflow: "hidden", border: "1px solid #e7e9ec", background: "#111" }}>
            {vncToken ? (
              // SECURITY: geen wachtwoord in deze URL — enkel een kortlevend,
              // eenmalig sessie-token. Onze eigen vnc-proxy-route (ons
              // domein, niet het externe noVNC-adres) wisselt dit token
              // server-side in voor het echte VNC_PASSWORD en stuurt dat
              // alleen in de HTML-respons terug, nooit in een querystring —
              // zie vnc-session/route.ts en vnc-proxy/[...path]/route.ts.
              <iframe
                key={vncToken}
                src={`/api/marktplaats/browser-test/vnc-proxy/vnc.html?session=${encodeURIComponent(vncToken)}`}
                title="Marktplaats browsersessie"
                allow="clipboard-read; clipboard-write"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                  pointerEvents: viewerInteractive ? "auto" : "none",
                }}
                tabIndex={viewerInteractive ? 0 : -1}
              />
            ) : vncError ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  padding: 16,
                  textAlign: "center",
                  color: "#e5e7eb",
                }}
              >
                <div style={{ fontSize: 13 }}>Live weergave niet beschikbaar — probeer opnieuw.</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>{vncError}</div>
                <button
                  onClick={retryVncSession}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid #4b5563",
                    background: "#1f2937",
                    color: "#e5e7eb",
                    cursor: "pointer",
                  }}
                >
                  Opnieuw proberen
                </button>
              </div>
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                  fontSize: 13,
                }}
              >
                {vncLoading ? "Live beeld laden…" : ""}
              </div>
            )}
          </div>
        </div>
      )}

      {run.state === "waiting_login" && (
        <div style={{ marginBottom: 14, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, color: "#92400e", marginBottom: 10 }}>Niet ingelogd op Marktplaats — vul hieronder in, of zet &quot;Browser handmatig bedienen&quot; aan om zelf in het beeld hierboven in te loggen.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email"
              autoComplete="username"
              value={loginUsername}
              onChange={(e) => {
                setLoginUsername(e.target.value);
                setLoginStatus("idle");
              }}
              placeholder="e-mailadres"
              style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 16, boxSizing: "border-box" }}
            />
            <input
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => {
                setLoginPassword(e.target.value);
                setLoginStatus("idle");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitLogin();
              }}
              placeholder="wachtwoord"
              style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 16, boxSizing: "border-box" }}
            />
            <button
              onClick={submitLogin}
              disabled={loginStatus === "sending" || !loginUsername.trim() || !loginPassword}
              style={{ ...btnStyle(true), padding: "12px 14px", fontSize: 16 }}
            >
              {loginStatus === "sending" ? "Bezig…" : "Inloggen"}
            </button>
          </div>
          {loginStatus === "sent" && <div style={{ marginTop: 10, fontSize: 13, color: "#16a34a" }}>Inloggegevens verstuurd naar de browser.</div>}
          {loginStatus === "error" && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>Versturen mislukt — probeer opnieuw.</div>}
        </div>
      )}

      {run.state === "waiting_code" && (
        <div style={{ marginBottom: 14, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, color: "#92400e", marginBottom: 10 }}>
            {(run.codeAttempts ?? 0) > 0
              ? "Vorige code was ongeldig of verlopen — vraag een nieuwe code aan via Marktplaats zelf (handmatig bedienen) en vul die hieronder in."
              : "Marktplaats vraagt een sms/e-mailcode — vul 'm hieronder in."}
          </div>
          <input
            inputMode="numeric"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeStatus("idle");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCode();
            }}
            placeholder="123456"
            style={{ width: "100%", padding: "14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 24, letterSpacing: 4, textAlign: "center", boxSizing: "border-box" }}
          />
          <button
            onClick={submitCode}
            disabled={codeStatus === "sending" || !code.trim()}
            style={{ ...btnStyle(true), width: "100%", marginTop: 10, padding: "12px 14px", fontSize: 16 }}
          >
            {codeStatus === "sending" ? "Bezig…" : "Versturen"}
          </button>
          {codeStatus === "sent" && <div style={{ marginTop: 10, fontSize: 13, color: "#16a34a" }}>Code verstuurd — wordt gecontroleerd (nog geen bevestigde login).</div>}
          {codeStatus === "error" && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>Versturen mislukt — probeer opnieuw.</div>}
        </div>
      )}

      {run.state === "verifying_code" && (
        <div style={{ marginBottom: 14, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12, fontSize: 13, color: "#92400e" }}>
          Code wordt gecontroleerd bij Marktplaats — nog niet bevestigd als geldige login.
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {run.statuses.map((s, i) => (
          <li key={`${s.field}-${i}`} style={{ padding: "3px 0", fontSize: 14, display: "flex", gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 14,
                flex: "0 0 14px",
                fontWeight: 700,
                color: s.status === "ok" ? "#16a34a" : s.status === "warning" ? "#b45309" : s.status === "error" ? "#dc2626" : "#6b7280",
              }}
            >
              {browserStatusIcon[s.status]}
            </span>
            <span>
              <b>{s.field}</b>
              {s.detail ? ` ${s.detail}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {Array.isArray(run.timings) && run.timings.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Tijd per stap:</div>
          {run.timings.map((t, i) => (
            <div key={`${t.step}-${i}`} style={{ display: "flex", justifyContent: "space-between", maxWidth: 320 }}>
              <span>{t.step}</span>
              <span>{(t.ms / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}

      {run.message && (
        <div style={{ marginTop: 8, fontSize: 14, color: accent, fontWeight: 600 }}>{run.message}</div>
      )}

      {run.postedUrl && (
        <div style={{ marginTop: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 10, fontSize: 14, color: "#065f46" }}>
          Testadvertentie staat online:{" "}
          <a href={run.postedUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            {run.postedUrl}
          </a>
          <div style={{ marginTop: 4 }}>Verwijder hem na afloop zelf uit Mijn Advertenties.</div>
        </div>
      )}

      {run.stoppedBeforeSubmit && !isActive && (
        <div style={{ marginTop: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 10, fontSize: 14, color: "#065f46" }}>
          De advertentie is <b>niet geplaatst</b>. De browser blijft open zodat je het formulier handmatig kunt controleren.
        </div>
      )}
    </div>
  );
}

/**
 * Illustrative mock-up of how the ad would render on Marktplaats — layout
 * only, not an official Marktplaats template (we have no design assets from
 * them, this is not the actual Marktplaats app/site). Modeled after
 * screenshots of a real Marktplaats listing page. Uses the same
 * title/description/price/images/attributes we'd actually send.
 */
function MarktplaatsAdPreview({ preview }: { preview: ProductPreview }) {
  const [activeImage, setActiveImage] = useState(0);
  const price = preview.payloadPreview?.priceModel?.askingPrice;
  const images = preview.imageUrls;
  const mainImage = images[activeImage];

  const specs = preview.attributeResults.filter((r) => r.shopifyValue);

  return (
    <div style={{ ...cardStyle(), padding: 0, overflow: "hidden", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ background: "#fff7ed", padding: "8px 16px", fontSize: 12, color: "#9a6b2a", borderBottom: "1px solid #fde3c4", textAlign: "center" }}>
        Voorbeeld — indicatieve weergave, geen officiële Marktplaats-pagina
      </div>

      {/* Header bar, mimics Marktplaats' orange chrome */}
      <div style={{ background: "#f47d21", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#fff" }}>
        <span style={{ fontSize: 20 }}>‹</span>
        <div style={{ display: "flex", gap: 14, fontSize: 16 }}>
          <span>♡</span>
          <span>⤴</span>
        </div>
      </div>

      {/* Main image with counter */}
      <div style={{ position: "relative", background: "#f3f4f6" }}>
        {mainImage ? (
          <img src={mainImage} alt={preview.marktplaatsTitle} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", aspectRatio: "1/1", display: "grid", placeItems: "center", color: "#9ca3af", fontSize: 13 }}>Geen foto</div>
        )}
        {images.length > 0 && (
          <span style={{ position: "absolute", left: 10, bottom: 10, background: "#000000b3", color: "#fff", fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>
            {activeImage + 1} / {images.length}
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "10px 14px", overflowX: "auto" }}>
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              onClick={() => setActiveImage(i)}
              style={{
                width: 50,
                height: 50,
                objectFit: "cover",
                borderRadius: 6,
                background: "#f3f4f6",
                cursor: "pointer",
                border: i === activeImage ? "2px solid #f47d21" : "2px solid transparent",
              }}
            />
          ))}
        </div>
      )}

      <div style={{ padding: "16px 16px 4px" }}>
        {/* Seller block — illustrative placeholder, not real seller data */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, borderBottom: "1px solid #f0f0f0", marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#e5e7eb", display: "grid", placeItems: "center", fontSize: 16, color: "#6b7280" }}>
            🏪
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1f3049" }}>iSelectStore ✓</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>★ Verkoper op Marktplaats</div>
          </div>
        </div>

        <h2 style={{ fontSize: 19, margin: "0 0 8px", lineHeight: 1.25, color: "#1f3049" }}>{preview.marktplaatsTitle || "(geen titel)"}</h2>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1f3049", marginBottom: 14 }}>{formatPrice(price) || "Prijs onbekend"}</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <div style={{ flex: 1, background: "#1f3049", color: "#fff", textAlign: "center", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>💬 Bericht</div>
          <div style={{ flex: 1, border: "1px solid #d1d5db", textAlign: "center", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#1f3049" }}>🌐 Website</div>
        </div>

        {specs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 12px", paddingBottom: 16, borderBottom: "1px solid #f0f0f0", marginBottom: 16 }}>
            {specs.map((s) => (
              <div key={s.internalField}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1f3049" }}>{s.shopifyValue}</div>
              </div>
            ))}
          </div>
        )}

        <h3 style={{ fontSize: 15, margin: "0 0 8px", color: "#1f3049" }}>Beschrijving</h3>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "#374151", lineHeight: 1.6, paddingBottom: 16 }}>{preview.marktplaatsDescription}</div>
      </div>
    </div>
  );
}

function btnStyle(primary = false): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 8,
    border: primary ? "none" : "1px solid #d1d5db",
    background: primary ? "#1f3049" : "#fff",
    color: primary ? "#fff" : "#1f3049",
    fontWeight: 600,
    cursor: "pointer",
  };
}

function cardStyle(): React.CSSProperties {
  return { background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 };
}
