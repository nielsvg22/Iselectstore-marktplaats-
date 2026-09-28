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

export interface AppliedField {
  key: string;
  value: string | number;
}

interface AIRecognitionPanelProps {
  productType: string;
  /** Bestaand product (edit mode): herkende velden worden via /api/ai/apply
   * weggeschreven naar Shopify. Zonder dit prop werkt de panel in create-mode
   * voor een nog niet bestaand product. */
  shopifyProductId?: string;
  /** Create mode: callback die de herkende velden direct in het openstaande
   * formulier zet (geen Shopify-write — het product bestaat nog niet).
   * Optioneel retourneert hij de sleutels die daadwerkelijk zijn toegepast
   * (formulier kan waarden die niet passen overslaan); anders gelden alle
   * aangeboden velden als toegepast. */
  onFieldsApplied?: (fields: AppliedField[]) => void | string[];
  /** Create mode: pas HIGH/MEDIUM-velden direct toe na herkenning. LOW en
   * conflicterende velden blijven altijd expliciet aan de gebruiker. */
  autoApply?: boolean;
  /** Roept de geüploade foto's (als data-URL) door zodra ze zijn ingelezen —
   * gebruikt door quick-create om ze in een draft te bewaren voor de Shopify-
   * extensie, los van of herkenning zelf slaagt. */
  onImagesReady?: (images: { dataUrl: string; filename: string }[]) => void;
}

const levelLabel: Record<Level, string> = { HIGH: "Hoog", MEDIUM: "Middel", LOW: "Laag" };
const levelColor: Record<Level, string> = { HIGH: "#16a34a", MEDIUM: "#d97706", LOW: "#dc2626" };

/** Auto-toepassing-regel (create mode): nooit LOW, nooit een onopgelost
 * conflict tussen foto's — die kiest de gebruiker zelf. */
export function isAutoApplyEligible(f: RecognizedField): boolean {
  if (f.level === "LOW") return false;
  if (f.sourceConflict && f.sourceConflict.length > 1) return false;
  return true;
}

export function selectAutoApplyFields(result: Pick<RecognitionResult, "fields">): AppliedField[] {
  return result.fields.filter(isAutoApplyEligible).map((f) => ({ key: f.key, value: f.value }));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AIRecognitionPanel({
  shopifyProductId,
  productType,
  onFieldsApplied,
  autoApply = false,
  onImagesReady,
}: AIRecognitionPanelProps) {
  const createMode = typeof onFieldsApplied === "function";
  const [files, setFiles] = useState<File[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, string | number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_FILES = 5;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => {
      const combined = [...prev, ...Array.from(list).filter((f) => f.type.startsWith("image/"))];
      if (combined.length > MAX_FILES) {
        setError(`Maximaal ${MAX_FILES} foto's per analyse — alleen de eerste ${MAX_FILES} worden gebruikt.`);
      }
      return combined.slice(0, MAX_FILES);
    });
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
      onImagesReady?.(images);
      const res = await fetch("/api/ai/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createMode
            ? { productType, images, mode: "create" }
            : { productType, productId: shopifyProductId, images, testMode }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "De AI-service is tijdelijk niet beschikbaar.");
      setResult(data.result);
      if (createMode && autoApply) {
        const eligible = selectAutoApplyFields(data.result as RecognitionResult);
        if (eligible.length > 0) {
          markApplied(onFieldsApplied!(eligible), eligible);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function applyFields(fieldsToApply: AppliedField[]) {
    if (fieldsToApply.length === 0) return;
    setError(null);
    if (createMode) {
      markApplied(onFieldsApplied!(fieldsToApply), fieldsToApply);
      return;
    }
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

  /** Create mode: markeert welke velden echt in het formulier zijn gezet.
   * Als het formulier waarden heeft overgeslagen (passen niet in het veld)
   * blijven die als "nog controleren" staan en verschijnt er een waarschuwing. */
  function markApplied(outcome: void | string[], offered: AppliedField[]) {
    const keys = Array.isArray(outcome) ? outcome : offered.map((f) => f.key);
    setAppliedKeys((prev) => new Set([...prev, ...keys]));
    if (Array.isArray(outcome) && keys.length < offered.length) {
      setError("Sommige herkende waarden passen niet in het formulier — die velden zijn niet gevuld; controleer ze handmatig.");
    }
  }

  function resolvedValue(f: RecognizedField): string | number {
    return choices[f.key] ?? f.value;
  }

  function applyAllCandidates(): RecognizedField[] {
    if (!result) return [];
    return result.fields.filter((f) => {
      if (f.level === "LOW" || appliedKeys.has(f.key)) return false;
      if (!createMode) return true;
      const hasConflict = Boolean(f.sourceConflict && f.sourceConflict.length > 1);
      return !hasConflict || choices[f.key] !== undefined;
    });
  }

  function applyAll() {
    applyFields(applyAllCandidates().map((f) => ({ key: f.key, value: resolvedValue(f) })));
  }

  const pendingCount = result ? result.fields.filter((f) => !appliedKeys.has(f.key)).length : 0;
  const showApplyAll = createMode
    ? applyAllCandidates().length > 0
    : !testMode && Boolean(result && result.fields.some((f) => f.level !== "LOW"));

  return (
    <div style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>AI Producterkenning</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: -4 }}>
        Upload tot {MAX_FILES} foto&apos;s van hetzelfde product (bijv. batterijconditie, &quot;Over deze Mac&quot;) — de AI combineert de
        informatie uit alle foto&apos;s en stelt kenmerken voor, jij bevestigt.
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
          {loading ? "Bezig…" : !createMode && testMode ? "Test AI herkenning" : "Gegevens uit foto halen"}
        </button>
        {!createMode && (
          <label style={{ fontSize: 13, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
            Testmodus (alleen resultaat tonen, niets opslaan)
          </label>
        )}
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, color: "#991b1b" }}>{error}</div>}

      {result && (
        <div>
          {createMode && (
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
              {files.length} foto(&apos;s) geanalyseerd · {result.fields.length} veld/velden herkend ·{" "}
              <span style={{ color: pendingCount === 0 ? "#16a34a" : "#d97706" }}>
                {appliedKeys.size} in formulier · {pendingCount} nog controleren
              </span>
            </div>
          )}

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
                    <div style={{ fontSize: 12, color: levelColor[f.level] }}>
                      Zekerheid: {levelLabel[f.level]}
                      {createMode && f.level === "LOW" ? " — handmatig controleren" : ""}
                    </div>
                  </div>
                  {(createMode || !testMode) && (
                    <button
                      onClick={() => applyFields([{ key: f.key, value: resolvedValue(f) }])}
                      disabled={appliedKeys.has(f.key)}
                      style={btnStyle(f.level !== "LOW")}
                    >
                      {appliedKeys.has(f.key) ? (createMode ? "In formulier ✓" : "Toegepast ✓") : "Toepassen"}
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

          {showApplyAll && (
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
