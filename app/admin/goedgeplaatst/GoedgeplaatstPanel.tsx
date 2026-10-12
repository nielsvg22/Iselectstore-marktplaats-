"use client";

import { useEffect, useRef, useState } from "react";

interface ConnectionStatus {
  mock: boolean;
  environment: "sandbox" | "production";
  state: "verbonden" | "niet_verbonden" | "sleutel_ontbreekt" | "ip_niet_toegestaan" | "api_fout";
  message: string;
  userIdConfigured: boolean;
  apiKeyConfigured: boolean;
  manufacturerConfigured: boolean;
  outboundIp: { ip: string | null; source: "live-check" | "unavailable"; message?: string };
  checkedAt: string;
}

interface CategoryGroup {
  groupId?: number;
  groupDescription?: string;
  categories: { categoryId: number; descriptions: { locale: string; description: string }[] }[];
}

interface AttributeDefinition {
  key: string;
  label: string;
  type: string;
  mandatory: boolean;
  writable: boolean;
}

interface CreateAdResult {
  mock: boolean;
  reused: boolean;
  adId: number;
  attributeStatuses: { key: string; label: string; mandatory: boolean; value: string | number | null; source: string }[];
  missingMandatory: string[];
  imagesAdded: number;
}

interface VerifyResult {
  mock: boolean;
  found: boolean;
  ad: { adId: number; title: string; description: string; status: string; created?: string; prices?: { price?: number; retailPrice?: number } } | null;
  savedInEnvironment: string;
  visibleInCustomerPortal: boolean;
  onMarktplaats: boolean;
  message: string;
}

const stateLabel: Record<ConnectionStatus["state"], string> = {
  verbonden: "✅ Verbonden",
  niet_verbonden: "⚪ Niet verbonden",
  sleutel_ontbreekt: "⚠️ API-sleutel ontbreekt",
  ip_niet_toegestaan: "⛔ IP-adres niet toegestaan",
  api_fout: "❌ API-fout",
};

const stateColor: Record<ConnectionStatus["state"], string> = {
  verbonden: "#16a34a",
  niet_verbonden: "#9ca3af",
  sleutel_ontbreekt: "#b45309",
  ip_niet_toegestaan: "#dc2626",
  api_fout: "#dc2626",
};

export function GoedgeplaatstPanel() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState("");

  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [categoriesMock, setCategoriesMock] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [attributesMock, setAttributesMock] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceEuros, setPriceEuros] = useState("");
  const [imageUrlsText, setImageUrlsText] = useState("");

  const [createResult, setCreateResult] = useState<CreateAdResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [concepts, setConcepts] = useState<{ adId: number; title: string; status: string }[] | null>(null);
  const [conceptsMock, setConceptsMock] = useState(false);

  // Idempotency key for the manual test form (STAP 9): generated once, only
  // regenerated when the user explicitly starts a new test ad — so repeated
  // clicks on "Opslaan als concept" while a request is in flight (or a
  // retried request) can never create a duplicate advertisement.
  const idempotencyKeyRef = useRef<string>(cryptoRandomId());
  const [linkKey, setLinkKey] = useState<string>(`manual:${idempotencyKeyRef.current}`);

  function resetTestForm() {
    idempotencyKeyRef.current = cryptoRandomId();
    setLinkKey(`manual:${idempotencyKeyRef.current}`);
    setTitle("");
    setDescription("");
    setPriceEuros("");
    setImageUrlsText("");
    setCreateResult(null);
    setVerifyResult(null);
  }

  useEffect(() => {
    refreshStatus();
    fetch("/api/goedgeplaatst/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCategories(data.groups ?? []);
          setCategoriesMock(Boolean(data.mock));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus() {
    setLoading("status");
    setError(null);
    try {
      const res = await fetch("/api/goedgeplaatst/connection-status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function loadAttributes(id: number) {
    setCategoryId(id);
    setAttributes([]);
    setLoading("attributes");
    try {
      const res = await fetch("/api/goedgeplaatst/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setAttributesMock(Boolean(data.mock));
      setAttributes((data.categoryAttributes?.attributes ?? []).flatMap((a: { attributes: AttributeDefinition[] }) => a.attributes));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function loadConcepts() {
    setLoading("concepts");
    setError(null);
    try {
      const res = await fetch("/api/goedgeplaatst/concepts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setConceptsMock(Boolean(data.mock));
      setConcepts(data.ads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function createTestAd() {
    if (categoryId === null) {
      setError("Kies eerst een categorie.");
      return;
    }
    setLoading("create");
    setError(null);
    try {
      const res = await fetch("/api/goedgeplaatst/create-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          categoryId,
          manual: {
            title,
            description,
            priceEuros: Number(priceEuros),
            imageUrls: imageUrlsText.split("\n").map((s) => s.trim()).filter(Boolean),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setCreateResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function checkAd() {
    setLoading("verify");
    setError(null);
    try {
      const res = await fetch(`/api/goedgeplaatst/verify?linkKey=${encodeURIComponent(linkKey)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setVerifyResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  const mockBanner = status?.mock ? (
    <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 600, color: "#9a3412" }}>
      🧪 GESIMULEERD (mock) — er wordt niets echt naar GoedGeplaatst gestuurd. Stel GOEDGEPLAATST_API_KEY en GOEDGEPLAATST_USER_ID in om dit uit te zetten.
    </div>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {mockBanner}

      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Verbindingsstatus</h3>
            {status ? (
              <div style={{ fontWeight: 700, color: stateColor[status.state], marginBottom: 4 }}>{stateLabel[status.state]}</div>
            ) : (
              <div style={{ color: "#6b7280" }}>Bezig met laden…</div>
            )}
            {status && <div style={{ fontSize: 13, color: "#6b7280", maxWidth: 480 }}>{status.message}</div>}
          </div>
          <button onClick={refreshStatus} disabled={loading !== null} style={btnStyle()}>
            {loading === "status" ? "Bezig…" : "Verbinding testen"}
          </button>
        </div>

        {status && (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 13 }}>
            <InfoTile label="Omgeving" value={status.environment === "production" ? "Productie" : "Sandbox"} />
            <InfoTile label="GoedGeplaatst userId" value={status.userIdConfigured ? "Ingesteld" : "Niet ingesteld"} />
            <InfoTile label="API-sleutel ingesteld" value={status.apiKeyConfigured ? "Ja" : "Nee"} />
            <InfoTile label="Fabrikantgegevens (GPSR)" value={status.manufacturerConfigured ? "Ingesteld" : "Niet ingesteld"} />
            <InfoTile
              label="Uitgaand server-IP"
              value={status.outboundIp.ip ?? status.outboundIp.message ?? "Onbekend"}
              hint={status.outboundIp.source === "unavailable" ? "Kon niet live bepaald worden — controleer handmatig op de server." : undefined}
            />
          </div>
        )}
      </div>

      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>Testadvertentie aanmaken</h3>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: -6 }}>
          Wordt UITSLUITEND als concept opgeslagen — er wordt nooit een publicatie-aanroep gedaan en er kunnen geen kosten ontstaan.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
          <label style={labelStyle()}>
            Admin-wachtwoord (vereist om op te slaan)
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} style={inputStyle()} />
          </label>

          <label style={labelStyle()}>
            Categorie {categoriesMock && <span style={mockTag()}>mock</span>}
            <select
              value={categoryId ?? ""}
              onChange={(e) => loadAttributes(Number(e.target.value))}
              style={inputStyle()}
            >
              <option value="" disabled>
                Kies een categorie…
              </option>
              {categories.flatMap((g) =>
                g.categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.descriptions?.[0]?.description ?? c.categoryId}
                  </option>
                ))
              )}
            </select>
          </label>

          {attributes.length > 0 && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Kenmerken voor deze categorie {attributesMock && <span style={mockTag()}>mock</span>}:{" "}
              {attributes.map((a) => `${a.label}${a.mandatory ? "*" : ""}`).join(", ")}
            </div>
          )}

          <label style={labelStyle()}>
            Titel (5-60 tekens)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} style={inputStyle()} />
          </label>
          <label style={labelStyle()}>
            Omschrijving
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={inputStyle()} />
          </label>
          <label style={labelStyle()}>
            Verkoopprijs (EUR)
            <input value={priceEuros} onChange={(e) => setPriceEuros(e.target.value)} inputMode="decimal" placeholder="249.95" style={inputStyle()} />
          </label>
          <label style={labelStyle()}>
            Productafbeeldingen — publieke URL&apos;s, één per regel (optioneel)
            <textarea value={imageUrlsText} onChange={(e) => setImageUrlsText(e.target.value)} rows={3} style={inputStyle()} />
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={createTestAd} disabled={loading !== null} style={btnStyle(true)}>
              {loading === "create" ? "Bezig…" : "Opslaan als concept in GoedGeplaatst"}
            </button>
            <button onClick={resetTestForm} disabled={loading !== null} style={btnStyle()}>
              Nieuw testformulier
            </button>
          </div>
        </div>

        {createResult && (
          <div style={{ marginTop: 14, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 12, fontSize: 14 }}>
            {createResult.mock && <div style={{ fontWeight: 700, color: "#9a3412", marginBottom: 4 }}>🧪 GESIMULEERD (mock)</div>}
            {createResult.reused ? (
              <div>Bestaande conceptadvertentie hergebruikt (geen dubbele advertentie aangemaakt) — adId <code>{createResult.adId}</code>.</div>
            ) : (
              <div>
                Concept aangemaakt — adId <code>{createResult.adId}</code>, {createResult.imagesAdded} afbeelding(en) toegevoegd.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Advertentie controleren</h3>
          <button onClick={checkAd} disabled={loading !== null} style={btnStyle()}>
            {loading === "verify" ? "Bezig…" : "Advertentie controleren"}
          </button>
        </div>
        {verifyResult && (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            {verifyResult.mock && <div style={{ fontWeight: 700, color: "#9a3412" }}>🧪 GESIMULEERD (mock)</div>}
            <div style={{ fontWeight: 600, color: verifyResult.found ? "#16a34a" : "#dc2626", marginBottom: 6 }}>{verifyResult.message}</div>
            {verifyResult.ad && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, color: "#374151" }}>
                <li>adId: <code>{verifyResult.ad.adId}</code></li>
                <li>Titel: {verifyResult.ad.title}</li>
                <li>Status: {verifyResult.ad.status}</li>
                <li>Prijs: {verifyResult.ad.prices?.price != null ? `€${(verifyResult.ad.prices.price / 100).toFixed(2)}` : "—"}</li>
                <li>Aangemaakt: {verifyResult.ad.created ?? "—"}</li>
              </ul>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "#6b7280" }}>
              <span>Opgeslagen in: {verifyResult.savedInEnvironment}</span>
              <span>Zichtbaar in klantportaal: {verifyResult.visibleInCustomerPortal ? "ja" : "nee (sandbox hoeft dit niet te zijn)"}</span>
              <span>Gepubliceerd op Marktplaats: {verifyResult.onMarktplaats ? "ja" : "nee (nooit in deze versie)"}</span>
            </div>
          </div>
        )}
      </div>

      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Concepten ophalen {conceptsMock && <span style={mockTag()}>mock</span>}</h3>
          <button onClick={loadConcepts} disabled={loading !== null} style={btnStyle()}>
            {loading === "concepts" ? "Bezig…" : "Concepten ophalen"}
          </button>
        </div>
        {concepts && (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 14 }}>
            {concepts.length === 0 && <li style={{ color: "#6b7280" }}>Geen concepten gevonden.</li>}
            {concepts.map((ad) => (
              <li key={ad.adId} style={{ padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                <code>{ad.adId}</code> — {ad.title} ({ad.status})
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, color: "#991b1b" }}>{error}</div>}
    </div>
  );
}

function InfoTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: "#f9fafb", border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontWeight: 600, color: "#1f3049", wordBreak: "break-word" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function labelStyle(): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600, color: "#374151" };
}

function inputStyle(): React.CSSProperties {
  return { padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" };
}

function mockTag(): React.CSSProperties {
  return { background: "#fff7ed", color: "#9a3412", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700, marginLeft: 6 };
}
