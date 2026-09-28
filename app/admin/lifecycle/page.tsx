"use client";

import { useEffect, useState } from "react";

interface LifecycleRow {
  shopifyProductId: string;
  productType: string | null;
  model: string | null;
  storage: string | null;
  inventoryQuantity: number | null;
  soldAt: string | null;
  unpublishedAt: string | null;
  status: string;
}

export default function LifecycleAdminPage() {
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<LifecycleRow[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const res = await fetch(`/api/lifecycle?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Fout");
      return;
    }
    setRows(data.dueForUnpublish);
  }

  function daysAgo(dateStr: string | null): string {
    if (!dateStr) return "—";
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    return `${days} dagen geleden`;
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>28-dagen cleanup</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Producten die langer dan 28 dagen uitverkocht zijn en uit de actieve catalogus gehaald moeten worden.</p>

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
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Product ID</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Type</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Model</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Opslag</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Verkocht op</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Voorraad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.shopifyProductId} style={{ borderTop: "1px solid #e7e9ec" }}>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.shopifyProductId}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.productType || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.model || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.storage || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{daysAgo(row.soldAt)}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.inventoryQuantity ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                  Geen producten die nu uit de catalogus gehaald moeten worden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 24, color: "#6b7280", fontSize: 13 }}>
        De cleanup draait automatisch elke nacht via de Vercel-cron op 04:00. Producten worden niet verwijderd, alleen uit de Online Store-publicatie gehaald.
      </p>
    </main>
  );
}
