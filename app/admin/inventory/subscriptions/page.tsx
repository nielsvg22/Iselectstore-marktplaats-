"use client";

import { useEffect, useState } from "react";

interface SubscriptionRow {
  id: number;
  email: string;
  productType: string;
  model: string;
  storage: string;
  signupAt: string;
  status: string;
  notifiedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Actief",
  notifying: "Verstuurt…",
  notified: "Verzonden",
  cancelled: "Geannuleerd",
};

const STATUS_COLOR: Record<string, string> = {
  active: "#16a34a",
  notifying: "#d97706",
  notified: "#6b7280",
  cancelled: "#9ca3af",
};

export default function InventorySubscriptionsPage() {
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const res = await fetch(`/api/inventory/subscriptions?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Fout");
      return;
    }
    setRows(data.subscriptions || []);
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Individuele aanmeldingen</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Elke regel is één e-mailadres gekoppeld aan exact één producttype + model + opslag.
      </p>

      <p style={{ margin: "0 0 20px" }}>
        <a href="/admin/inventory" style={{ color: "#1f3049", fontSize: 14, fontWeight: 600 }}>
          ← Terug naar het overzicht
        </a>
      </p>

      {!rows && (
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

      {rows && (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, overflow: "hidden" }}>
          <thead>
            <tr style={{ background: "#f7f7f7", textAlign: "left" }}>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>E-mail</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Type</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Model</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Opslag</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Aangemeld</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Gemeld op</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e7e9ec" }}>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.email}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.productType}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.model}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.storage}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600, color: STATUS_COLOR[row.status] || "#6b7280" }}>
                  {STATUS_LABEL[row.status] || row.status}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 14, color: "#6b7280" }}>{new Date(row.signupAt).toLocaleString("nl-NL")}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, color: "#6b7280" }}>
                  {row.notifiedAt ? new Date(row.notifiedAt).toLocaleString("nl-NL") : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                  Nog geen aanmeldingen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
