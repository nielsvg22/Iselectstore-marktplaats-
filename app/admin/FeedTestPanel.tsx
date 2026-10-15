"use client";

import { useState } from "react";

interface FeedDebugResult {
  included: number;
  skipped: { shopifyProductId: string; reason: string }[];
}

const FEED_PATH = "/api/marktplaats/feed";

export function FeedTestPanel() {
  const [result, setResult] = useState<FeedDebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);

  async function testFeed() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${FEED_PATH}?debug=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onbekende fout");
      setResult(data);
      if (typeof window !== "undefined") setFeedUrl(`${window.location.origin}${FEED_PATH}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable (http, permissions) — url is still shown to copy by hand */
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16, marginBottom: 24 }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>Marktplaats Zakelijk — product feed</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 0 }}>
        Deze feed-URL vul je eenmalig in bij Marktplaats Zakelijk (Promotie → Feed). Zij halen hem dagelijks rond 07:00 op — geen login nodig.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: feedUrl ? 12 : 0 }}>
        <button onClick={testFeed} disabled={loading} style={btnStyle(true)}>
          {loading ? "Bezig…" : "Test product feed"}
        </button>
        <a href={FEED_PATH} target="_blank" rel="noreferrer" style={{ ...btnStyle(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
          Bekijk volledige XML →
        </a>
      </div>

      {feedUrl && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <code style={{ flex: 1, background: "#f7f7f7", padding: "8px 10px", borderRadius: 6, fontSize: 13, overflowX: "auto", whiteSpace: "nowrap" }}>
            {feedUrl}
          </code>
          <button onClick={copyUrl} style={btnStyle(false)}>
            {copied ? "Gekopieerd ✓" : "Kopieer URL"}
          </button>
        </div>
      )}

      {error && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 10, color: "#991b1b", fontSize: 14 }}>{error}</div>}

      {result && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: result.included > 0 ? "#16a34a" : "#b45309", marginBottom: 8 }}>
            {result.included} advertentie(s) in de feed{result.skipped.length > 0 ? `, ${result.skipped.length} overgeslagen` : ""}
          </div>
          {result.skipped.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, color: "#6b7280", maxHeight: 220, overflowY: "auto" }}>
              {result.skipped.map((s, i) => (
                <li key={i} style={{ padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <b>{s.shopifyProductId}</b>: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "9px 14px",
    borderRadius: 8,
    border: primary ? "none" : "1px solid #d1d5db",
    background: primary ? "#1f3049" : "#fff",
    color: primary ? "#fff" : "#1f3049",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  };
}
