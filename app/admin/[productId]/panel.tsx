"use client";

import { useState } from "react";

type CheckStatus = "ok" | "warning" | "error";

interface ValidationCheck {
  label: string;
  status: CheckStatus;
  detail?: string;
}

interface AttributeMappingResult {
  internalField: string;
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

export function MarktplaatsPanel({ shopifyProductId }: { shopifyProductId: string }) {
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [fullTestResult, setFullTestResult] = useState<{ passed: boolean; steps: { label: string; ok: boolean; detail?: string }[]; mock: boolean } | null>(null);
  const [publishResult, setPublishResult] = useState<{ advertisementId: string; mock: boolean } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdPreview, setShowAdPreview] = useState(false);

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
        <button onClick={publish} disabled={loading !== null || (preview ? !preview.validation.publishable : false)} style={btnStyle(true)}>
          {loading === "publish" ? "Bezig…" : "Publiceren op Marktplaats"}
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
                {attrStatusIcon[r.status] ?? "•"} <b>{r.internalField}</b>: {r.shopifyValue || "—"}
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
    </div>
  );
}

function formatPrice(cents: number | undefined): string {
  if (!cents && cents !== 0) return "";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents);
}

/**
 * Illustrative mock-up of how the ad would render on Marktplaats — layout
 * only, not an official Marktplaats template (we have no design assets from
 * them). Uses the same title/description/price/images we'd actually send.
 */
function MarktplaatsAdPreview({ preview }: { preview: ProductPreview }) {
  const price = preview.payloadPreview?.priceModel?.askingPrice;
  const mainImage = preview.imageUrls[0];

  return (
    <div style={{ ...cardStyle(), padding: 0, overflow: "hidden" }}>
      <div style={{ background: "#f3f4f6", padding: "8px 16px", fontSize: 12, color: "#6b7280", borderBottom: "1px solid #e7e9ec" }}>
        Voorbeeld — indicatieve weergave, geen officieel Marktplaats-sjabloon
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 20 }}>
        <div style={{ flex: "0 0 260px" }}>
          {mainImage ? (
            <img src={mainImage} alt={preview.marktplaatsTitle} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 8, background: "#f3f4f6" }} />
          ) : (
            <div style={{ width: "100%", aspectRatio: "4/3", background: "#f3f4f6", borderRadius: 8, display: "grid", placeItems: "center", color: "#9ca3af", fontSize: 13 }}>Geen foto</div>
          )}
          {preview.imageUrls.length > 1 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }}>
              {preview.imageUrls.slice(1, 5).map((src, i) => (
                <img key={i} src={src} alt="" style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, background: "#f3f4f6" }} />
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 240 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {preview.categoryMapping ? `${preview.categoryMapping.l1CategoryName} > ${preview.categoryMapping.l2CategoryName}` : "Categorie onbekend"}
          </div>
          <h2 style={{ fontSize: 20, margin: "0 0 8px", lineHeight: 1.25 }}>{preview.marktplaatsTitle || "(geen titel)"}</h2>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#1f3049", marginBottom: 14 }}>{formatPrice(price) || "Prijs onbekend"}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "#374151", lineHeight: 1.5 }}>{preview.marktplaatsDescription}</div>
        </div>
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
