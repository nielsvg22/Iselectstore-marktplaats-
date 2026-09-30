"use client";

import { useEffect, useState } from "react";

interface CountRow {
  productType: string;
  model: string;
  storage: string;
  total: number;
  active: number;
  notified: number;
  lastSignup?: string | null;
}

export default function InventoryAdminPage() {
  const [password, setPassword] = useState("");
  const [counts, setCounts] = useState<CountRow[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const res = await fetch(`/api/inventory/counts?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Fout");
      return;
    }
    setCounts(data.counts);
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Voorraadmeldingen</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Overzicht van actieve aanmeldingen per productidentiteit.</p>

      {!counts && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <input
            type="password"
            placeholder="Admin wachtwoord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #e7e9ec", fontSize: 14 }}
          />
          <button
            onClick={load}
            style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#f9858b", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Laden
          </button>
        </div>
      )}

      {error && <div style={{ color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {counts && (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#f7f7f7", textAlign: "left" }}>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Type</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Model</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Opslag</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Actief</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Verzonden</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Totaal</th>
                <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Laatste aanmelding</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((row, i) => (
                <tr key={i} style={{ borderTop: "1px solid #e7e9ec" }}>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.productType}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.model}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.storage}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: "#16a34a" }}>{row.active}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.notified}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.total}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#6b7280" }}>
                    {row.lastSignup ? new Date(row.lastSignup).toLocaleString("nl-NL") : "—"}
                  </td>
                </tr>
              ))}
              {counts.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                    Nog geen voorraadmeldingen ontvangen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 24 }}>
            <a
              href="/admin/inventory/subscriptions"
              style={{ color: "#1f3049", fontSize: 14, fontWeight: 600 }}
            >
              Bekijk alle individuele aanmeldingen →
            </a>
          </div>
        </>
      )}
    </main>
  );
}
