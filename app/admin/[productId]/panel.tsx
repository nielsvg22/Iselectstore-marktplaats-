"use client";

import { useState } from "react";
import { AIRecognitionPanel } from "../AIRecognitionPanel";

type CheckStatus = "ok" | "warning" | "error";

interface ValidationCheck {
  label: string;
  status: CheckStatus;
  detail?: string;
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

export function MarktplaatsPanel({ shopifyProductId, productType }: { shopifyProductId: string; productType: string }) {
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
