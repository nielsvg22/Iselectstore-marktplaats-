"use client";

import { useRef, useState } from "react";

type Level = "HIGH" | "MEDIUM" | "LOW";

interface RecognizedField {
  key: string;
  label: string;
  value: string | number;
  confidence: number;
  level: Level;
  existingValue?: string;
  differsFromExisting?: boolean;
  sourceConflict?: { imageIndex: number; filename?: string; value: string | number }[];
}

interface RecognitionResult {
  productType: string;
  fields: RecognizedField[];
  omittedFields: { key: string; label: string; reason: string }[];
  warnings: string[];
  raw: unknown;
}

const levelLabel: Record<Level, string> = { HIGH: "Hoog", MEDIUM: "Middel", LOW: "Laag" };
const levelColor: Record<Level, string> = { HIGH: "#16a34a", MEDIUM: "#d97706", LOW: "#dc2626" };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AIRecognitionPanel({ shopifyProductId, productType }: { shopifyProductId: string; productType: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, string | number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list).filter((f) => f.type.startsWith("image/"))]);
  }

  async function analyze() {
    if (files.length === 0) {
      setError("Upload eerst één of meer foto's.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setAppliedKeys(new Set());
    setChoices({});
    try {
      const images = await Promise.all(files.map(async (f) => ({ dataUrl: await fileToDataUrl(f), filename: f.name })));
      const res = await fetch("/api/ai/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productType, productId: shopifyProductId, images, testMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "De AI-service is tijdelijk niet beschikbaar.");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function applyFields(fieldsToApply: { key: string; value: string | number }[]) {
    if (fieldsToApply.length === 0) return;
    setError(null);
    try {
      const res = await fetch("/api/ai/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: shopifyProductId, productType, fields: fieldsToApply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toepassen mislukt.");
      setAppliedKeys((prev) => new Set([...prev, ...data.applied]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function resolvedValue(f: RecognizedField): string | number {
    return choices[f.key] ?? f.value;
  }

  function applyAll() {
    if (!result) return;
    const eligible = result.fields.filter((f) => f.level !== "LOW" && !appliedKeys.has(f.key));
    applyFields(eligible.map((f) => ({ key: f.key, value: resolvedValue(f) })));
  }

  return (
    <div style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>AI Producterkenning</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: -4 }}>
        Upload een foto of screenshot (bijv. batterijconditie, &quot;Over deze Mac&quot;) — de AI stelt kenmerken voor, jij bevestigt.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: "2px dashed #d1d5db",
          borderRadius: 10,
          padding: 20,
          textAlign: "center",
          cursor: "pointer",
          color: "#6b7280",
          fontSize: 14,
          marginBottom: 10,
        }}
      >
        {files.length === 0 ? "Klik om foto's te kiezen of sleep ze hierheen" : `${files.length} foto('s) geselecteerd`}
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {files.map((f, i) => (
            <span key={i} style={{ fontSize: 12, background: "#f3f4f6", borderRadius: 6, padding: "4px 8px" }}>
              {f.name}{" "}
              <button
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ border: "none", background: "none", color: "#9ca3af", cursor: "pointer" }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
        <button onClick={analyze} disabled={loading} style={btnStyle(true)}>
          {loading ? "Bezig…" : testMode ? "Test AI herkenning" : "Gegevens uit foto halen"}
        </button>
        <label style={{ fontSize: 13, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          Testmodus (alleen resultaat tonen, niets opslaan)
        </label>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, color: "#991b1b" }}>{error}</div>}

      {result && (
        <div>
          {result.warnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 13, color: "#92400e" }}>
              {result.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          {result.fields.length === 0 && <p style={{ fontSize: 14, color: "#6b7280" }}>Geen bruikbare gegevens herkend op de foto(&apos;s).</p>}

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {result.fields.map((f) => (
              <li key={f.key} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>{f.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#1f3049" }}>{String(resolvedValue(f))}</div>
                    <div style={{ fontSize: 12, color: levelColor[f.level] }}>Zekerheid: {levelLabel[f.level]}</div>
                  </div>
                  {!testMode && (
                    <button
                      onClick={() => applyFields([{ key: f.key, value: resolvedValue(f) }])}
                      disabled={appliedKeys.has(f.key)}
                      style={btnStyle(f.level !== "LOW")}
                    >
                      {appliedKeys.has(f.key) ? "Toegepast ✓" : "Toepassen"}
                    </button>
                  )}
                </div>

                {f.differsFromExisting && (
                  <div style={{ marginTop: 8, background: "#fff7ed", border: "1px solid #fde3c4", borderRadius: 8, padding: 10, fontSize: 13 }}>
                    ⚠ Verschil gevonden — huidige waarde in Shopify: <b>{f.existingValue}</b>
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button
                        onClick={() => setChoices((prev) => ({ ...prev, [f.key]: f.existingValue! }))}
                        style={{ ...btnStyle(), fontSize: 12, padding: "6px 10px" }}
                      >
                        Behouden {f.existingValue}
                      </button>
                      <button
                        onClick={() => setChoices((prev) => ({ ...prev, [f.key]: f.value }))}
                        style={{ ...btnStyle(), fontSize: 12, padding: "6px 10px" }}
                      >
                        Gebruik {f.value}
                      </button>
                    </div>
                  </div>
                )}

                {f.sourceConflict && f.sourceConflict.length > 1 && (
                  <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, fontSize: 13 }}>
                    ⚠ Conflict tussen foto&apos;s:
                    {f.sourceConflict.map((c) => (
                      <div key={c.imageIndex}>
                        {c.filename ?? `Foto ${c.imageIndex + 1}`} → {c.value}{" "}
                        <button onClick={() => setChoices((prev) => ({ ...prev, [f.key]: c.value }))} style={{ ...btnStyle(), fontSize: 12, padding: "4px 8px", marginLeft: 6 }}>
                          Gebruik deze
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {result.omittedFields.length > 0 && (
            <details style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
              <summary>Niet herkende velden ({result.omittedFields.length})</summary>
              {result.omittedFields.map((o) => (
                <div key={o.key}>
                  {o.label}: {o.reason}
                </div>
              ))}
            </details>
          )}

          {!testMode && result.fields.some((f) => f.level !== "LOW") && (
            <div style={{ marginTop: 12 }}>
              <button onClick={applyAll} style={btnStyle(true)}>
                Alles toepassen
              </button>
            </div>
          )}
        </div>
      )}
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
