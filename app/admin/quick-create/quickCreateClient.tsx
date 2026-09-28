"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AIRecognitionPanel, type AppliedField } from "../AIRecognitionPanel";
import { getTemplate } from "@/lib/templates/registry";
import { buildQuickProductTitles, validateQuickProductData } from "@/lib/templates/quickProduct";
import type { FieldDef, ProductTemplate } from "@/lib/templates/types";
import { aiFieldsToValues, initialValuesFor, missingRequiredCount } from "./quickCreateLogic";

interface CreatedProduct {
  productId: string;
  title: string;
  status?: string;
  productType: string;
  shopifyTitle: string;
  marktplaatsTitle: string;
}

interface QuickCreateClientProps {
  initialProductType: string;
  knownProductTypes: string[];
  storeSubdomain: string;
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e7e9ec",
  borderRadius: 12,
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#1f3049",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "9px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  color: "#1f3049",
  background: "#fff",
};

const helpStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", marginTop: 3 };
const errorStyle: React.CSSProperties = { fontSize: 12, color: "#dc2626", marginTop: 3 };

function btnStyle(primary = false): React.CSSProperties {
  return {
    padding: "10px 18px",
    borderRadius: 8,
    border: primary ? "none" : "1px solid #d1d5db",
    background: primary ? "#1f3049" : "#fff",
    color: primary ? "#fff" : "#1f3049",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  };
}

function issuesByKey(list: { key: string; message: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of list ?? []) map[issue.key] = issue.message;
  return map;
}

function FieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDef;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const label = field.required ? field.label : `${field.label} (optioneel)`;
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {field.kind === "boolean" ? (
        <label style={{ fontSize: 14, color: "#1f3049", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          {field.help || label}
        </label>
      ) : field.kind === "textarea" ? (
        <textarea
          value={value}
          rows={3}
          placeholder={field.help || ""}
          style={{ ...inputStyle, resize: "vertical" }}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === "select" ? (
        <select value={value} style={inputStyle} onChange={(e) => onChange(e.target.value)}>
          <option value="">Kies een optie</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.kind === "number" ? "number" : "text"}
          value={value}
          placeholder={field.help || ""}
          style={inputStyle}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && field.kind !== "boolean" && <div style={helpStyle}>{field.help}</div>}
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

export function QuickCreateClient({ initialProductType, knownProductTypes, storeSubdomain }: QuickCreateClientProps) {
  const [productType, setProductType] = useState(initialProductType);
  const [values, setValues] = useState<Record<string, string>>(() => initialValuesFor(initialProductType));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedProduct | null>(null);

  // Spiegel van de laatste formulerwaarden zodat AI-toepassing altijd op de
  // meest recente state werkt (setValues-updaters zijn niet synchroon).
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const template: ProductTemplate | undefined = getTemplate(productType);
  const missing = missingRequiredCount(template, values);
  const titles = buildQuickProductTitles(productType, values);

  function handleTypeChange(next: string) {
    if (next === productType) return;
    setProductType(next);
    const fresh = initialValuesFor(next);
    setValues(fresh);
    valuesRef.current = fresh;
    setIssues({});
    setFormError("");
  }

  function handleValueChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setIssues((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleFieldsApplied(fields: AppliedField[]): string[] {
    const outcome = aiFieldsToValues(template, valuesRef.current, fields);
    valuesRef.current = outcome.values;
    setValues(outcome.values);
    return outcome.appliedKeys;
  }

  async function submit(status: "draft" | "active") {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const validation = validateQuickProductData(productType, values);
      setIssues(issuesByKey(validation.issues));
      if (!validation.ok) {
        setFormError(
          `Vul de gemarkeerde velden correct in. ${validation.issues.map((i) => i.message).join(" ")}`.trim()
        );
        return;
      }
      const res = await fetch("/api/admin/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productType, status, values: validation.values }),
      });
      let data: (CreatedProduct & { error?: string; issues?: { key: string; message: string }[] }) | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        setFormError(data?.error || "Het aanmaken van het product is mislukt. Probeer het opnieuw.");
        if (data?.issues && data.issues.length) setIssues(issuesByKey(data.issues));
        return;
      }
      if (data) setCreated(data);
    } catch {
      setFormError("Geen verbinding met de iSelect-backend. Controleer je internetverbinding.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreated(null);
    const fresh = initialValuesFor(productType);
    setValues(fresh);
    valuesRef.current = fresh;
    setIssues({});
    setFormError("");
  }

  if (created) {
    const statusLabel =
      created.status === "active" ? "Actief (zichtbaar in de webshop)" : "Concept (nog niet zichtbaar)";
    return (
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>✅ Product aangemaakt</h2>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1f3049" }}>{created.title}</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
          <div>
            <b>Shopify-titel:</b> {created.shopifyTitle}
          </div>
          <div>
            <b>Marktplaats-titel:</b> {created.marktplaatsTitle}
          </div>
          <div>
            <b>Status:</b> {statusLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16, fontSize: 14 }}>
          {storeSubdomain && (
            <a
              href={`https://admin.shopify.com/store/${storeSubdomain}/products/${created.productId}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1f3049", fontWeight: 600 }}
            >
              Open product in Shopify →
            </a>
          )}
          <Link href={`/admin/${created.productId}`} style={{ color: "#1f3049", fontWeight: 600 }}>
            Open Marktplaats controle →
          </Link>
          <button onClick={reset} style={{ ...btnStyle(true), marginLeft: "auto" }}>
            Nieuw product toevoegen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {formError && (
        <div
          style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 10,
            padding: 12,
            color: "#991b1b",
            fontSize: 14,
          }}
        >
          {formError}
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Producttype</h3>
        <label style={labelStyle} htmlFor="quick-create-producttype">
          Producttype (iSelect-template)
        </label>
        <select
          id="quick-create-producttype"
          value={productType}
          style={inputStyle}
          onChange={(e) => handleTypeChange(e.target.value)}
        >
          {knownProductTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {issues.productType && <div style={errorStyle}>{issues.productType}</div>}
      </div>

      <AIRecognitionPanel
        key={productType}
        productType={productType}
        onFieldsApplied={handleFieldsApplied}
        autoApply
      />

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>Productgegevens</h3>
          <span style={{ fontSize: 13, color: missing > 0 ? "#d97706" : "#16a34a" }}>
            {missing > 0
              ? `Nog ${missing} verplicht${missing === 1 ? " veld" : "e velden"} invullen`
              : "✓ Alle verplichte velden gevuld"}
          </span>
        </div>
        {template ? (
          template.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              error={issues[field.key]}
              onChange={(value) => handleValueChange(field.key, value)}
            />
          ))
        ) : (
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            Dit producttype heeft geen iSelect-template.
          </p>
        )}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Live titelpreviews</h3>
        <div style={{ fontSize: 14 }}>
          <div>
            <b>Shopify:</b> {titles.shopifyTitle || "—"}
          </div>
          <div>
            <b>Marktplaats:</b> {titles.marktplaatsTitle || "—"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => submit("draft")} disabled={busy} style={btnStyle()}>
          {busy ? "Bezig…" : "Opslaan als concept"}
        </button>
        <button onClick={() => submit("active")} disabled={busy} style={btnStyle(true)}>
          {busy ? "Bezig…" : "Product aanmaken en publiceren"}
        </button>
      </div>
    </div>
  );
}
