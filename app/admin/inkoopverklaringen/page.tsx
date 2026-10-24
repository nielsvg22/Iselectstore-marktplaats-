"use client";

import { Fragment, useState } from "react";

interface DeclarationRow {
  id: number;
  voornaam: string;
  achternaam: string;
  email: string | null;
  adres: string;
  postcode: string;
  woonplaats: string;
  datumVerkoop: string;
  product: string;
  bedrag: number;
  verklaringEigenaar: boolean;
  verklaringAbonnement: boolean;
  verklaringThuiskopie: boolean;
  handtekening: string;
  status: string;
  createdAt: string;
}

export default function InkoopverklaringenPage() {
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<DeclarationRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  async function load() {
    setError("");
    const res = await fetch(`/api/inkoopverklaring/list?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Fout");
      return;
    }
    setRows(data.declarations || []);
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Inkoopverklaringen</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Aanmeldingen van klanten die een toestel aan iSelectStore verkopen, inclusief handtekening.
      </p>

      <p style={{ margin: "0 0 20px" }}>
        <a href="/admin" style={{ color: "#1f3049", fontSize: 14, fontWeight: 600 }}>
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
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Naam</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Product</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Bedrag</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Datum verkoop</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Aangemeld</th>
              <th style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr style={{ borderTop: "1px solid #e7e9ec" }}>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>
                    {row.voornaam} {row.achternaam}
                    {row.email && <div style={{ fontSize: 12, color: "#6b7280" }}>{row.email}</div>}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{row.product}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>
                    €{row.bedrag.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#6b7280" }}>
                    {new Date(row.datumVerkoop).toLocaleDateString("nl-NL")}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#6b7280" }}>
                    {new Date(row.createdAt).toLocaleString("nl-NL")}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>
                    <button
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                      style={{ background: "none", border: "none", color: "#1f3049", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                    >
                      {open === row.id ? "Verbergen ▲" : "Details ▼"}
                    </button>
                  </td>
                </tr>
                {open === row.id && (
                  <tr style={{ borderTop: "1px solid #e7e9ec", background: "#f9fafb" }}>
                    <td colSpan={6} style={{ padding: "16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                          <div><b>Adres:</b> {row.adres}</div>
                          <div><b>Postcode / plaats:</b> {row.postcode} {row.woonplaats}</div>
                          <div style={{ marginTop: 8 }}>
                            <b>Verklaringen:</b>{" "}
                            {row.verklaringEigenaar ? "✅ Eigenaar" : "❌ Eigenaar"}{" · "}
                            {row.verklaringAbonnement ? "✅ Abonnement" : "❌ Abonnement"}{" · "}
                            {row.verklaringThuiskopie ? "✅ Thuiskopie" : "❌ Thuiskopie"}
                          </div>
                          <a
                            href={`/api/inkoopverklaring/${row.id}/pdf?password=${encodeURIComponent(password)}`}
                            target="_blank"
                            rel="noopener"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 14,
                              padding: "8px 14px",
                              borderRadius: 8,
                              background: "#1f3049",
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 13,
                              textDecoration: "none",
                            }}
                          >
                            📄 PDF downloaden
                          </a>
                        </div>
                        <div>
                          <b style={{ fontSize: 13 }}>Handtekening:</b>
                          <div style={{ marginTop: 6, border: "1px solid #e7e9ec", borderRadius: 8, background: "#fff", display: "inline-block", padding: 8 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={row.handtekening} alt="Handtekening" style={{ maxWidth: 260, display: "block" }} />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                  Nog geen inkoopverklaringen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
