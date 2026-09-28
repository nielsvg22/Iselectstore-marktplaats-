"use client";

import { useState } from "react";

interface Settings {
  mode: "none" | "auto";
  delayHours: number;
  stickerText: string;
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  style: "pill" | "ribbon";
  sizePercent: number;
  opacity: number;
  bandColorHex: string;
  textColorHex: string;
}

const positionLabels: Record<Settings["position"], string> = {
  center: "Midden",
  "top-left": "Linksboven",
  "top-right": "Rechtsboven",
  "bottom-left": "Linksonder",
  "bottom-right": "Rechtsonder",
};

const styleLabels: Record<Settings["style"], string> = {
  pill: "Badge (compacte ronde pil, zoals de andere productlabels)",
  ribbon: "Lint (diagonale banner over de hoek)",
};

export function SoldImageSettingsForm({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/sold-images/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings(data.settings);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function registerWebhook() {
    setRegistering(true);
    setRegisterResult(null);
    try {
      const res = await fetch("/api/webhooks/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      setRegisterResult(res.ok ? `✅ Webhook geregistreerd (id: ${data.webhook.id})` : `❌ ${JSON.stringify(data.error)}`);
    } catch (err) {
      setRegisterResult(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>Na verkoop</h3>
        <label style={radioRow()}>
          <input type="radio" checked={settings.mode === "none"} onChange={() => setSettings((s) => ({ ...s, mode: "none" }))} />
          Niets doen
        </label>
        <label style={radioRow()}>
          <input type="radio" checked={settings.mode === "auto"} onChange={() => setSettings((s) => ({ ...s, mode: "auto" }))} />
          Automatisch VERKOCHT-sticker toevoegen
        </label>

        {settings.mode === "auto" && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle()}>Vertraging (uren na uitverkocht raken, 0 = direct)</label>
            <input
              type="number"
              min={0}
              value={settings.delayHours}
              onChange={(e) => setSettings((s) => ({ ...s, delayHours: Math.max(0, Number(e.target.value)) }))}
              style={inputStyle()}
            />
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
              &quot;Direct&quot; (0 uur) is echt realtime — verwerkt zodra Shopify de voorraadwijziging meldt. Een
              vertraging van X uur wordt pas verwerkt bij de eerstvolgende dagelijkse controle ná die X uur (Vercel
              Hobby-limiet: max. 1x per dag), dus mogelijk later dan exact X uur.
            </div>
          </div>
        )}
      </div>

      {settings.mode === "auto" && (
        <div style={cardStyle()}>
          <h3 style={{ marginTop: 0 }}>Stijl van de sticker</h3>

          <label style={labelStyle()}>Tekst</label>
          <input type="text" value={settings.stickerText} onChange={(e) => setSettings((s) => ({ ...s, stickerText: e.target.value }))} style={inputStyle()} />

          <label style={labelStyle()}>Positie</label>
          <select value={settings.position} onChange={(e) => setSettings((s) => ({ ...s, position: e.target.value as Settings["position"] }))} style={inputStyle()}>
            {Object.entries(positionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          {settings.position !== "center" && (
            <>
              <label style={labelStyle()}>Vorm</label>
              <select value={settings.style} onChange={(e) => setSettings((s) => ({ ...s, style: e.target.value as Settings["style"] }))} style={inputStyle()}>
                {Object.entries(styleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}

          <label style={labelStyle()}>Grootte ({settings.sizePercent}% van de fotobreedte)</label>
          <input
            type="range"
            min={10}
            max={100}
            value={settings.sizePercent}
            onChange={(e) => setSettings((s) => ({ ...s, sizePercent: Number(e.target.value) }))}
            style={{ width: "100%" }}
          />

          <label style={labelStyle()}>Transparantie ({Math.round(settings.opacity * 100)}% dekking)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.opacity * 100)}
            onChange={(e) => setSettings((s) => ({ ...s, opacity: Number(e.target.value) / 100 }))}
            style={{ width: "100%" }}
          />

          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <div>
              <label style={labelStyle()}>Bandkleur</label>
              <input type="color" value={settings.bandColorHex} onChange={(e) => setSettings((s) => ({ ...s, bandColorHex: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle()}>Tekstkleur</label>
              <input type="color" value={settings.textColorHex} onChange={(e) => setSettings((s) => ({ ...s, textColorHex: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={save} disabled={saving} style={btnStyle(true)}>
          {saving ? "Opslaan…" : "Instellingen opslaan"}
        </button>
        {saved && <span style={{ color: "#16a34a", fontSize: 14 }}>✅ Opgeslagen</span>}
      </div>

      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>Eenmalige koppeling</h3>
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          Registreer de Shopify-webhook die voorraadwijzigingen detecteert. Dit hoeft maar één keer, na het eerst
          deployen van deze functie.
        </p>
        <input type="password" placeholder="Admin-paneel wachtwoord" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle()} />
        <button onClick={registerWebhook} disabled={registering} style={{ ...btnStyle(), marginTop: 8 }}>
          {registering ? "Bezig…" : "Webhook registreren"}
        </button>
        {registerResult && <div style={{ marginTop: 8, fontSize: 13 }}>{registerResult}</div>}
      </div>
    </div>
  );
}

function labelStyle(): React.CSSProperties {
  return { display: "block", fontSize: 13, color: "#6b7280", marginTop: 10, marginBottom: 4 };
}
function radioRow(): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 14 };
}
function inputStyle(): React.CSSProperties {
  return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 };
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
