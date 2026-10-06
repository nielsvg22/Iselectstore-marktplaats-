import Link from "next/link";
import { listProducts } from "@/lib/shopify/client";
import { getConnectionStatus } from "@/lib/marktplaats/connectionService";
import { getTemplate } from "@/lib/templates/registry";
import { FeedTestPanel } from "./FeedTestPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [products, status] = await Promise.all([listProducts(50), getConnectionStatus()]);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Marktplaats</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Shopify blijft de source of truth — kies een product om de Marktplaats-mapping te bekijken.</p>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 13 }}>
        <Link href="/admin/quick-create" style={{ color: "#1f3049" }}>➕ Nieuw product (AI) →</Link>
        <Link href="/admin/sold-images" style={{ color: "#1f3049" }}>⚙️ VERKOCHT-sticker instellingen →</Link>
        <Link href="/admin/inventory" style={{ color: "#1f3049" }}>🔔 Voorraadmeldingen →</Link>
        <Link href="/admin/lifecycle" style={{ color: "#1f3049" }}>📦 28-dagen cleanup →</Link>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>Account: {status.connected ? "✅ gekoppeld" : "❌ niet gekoppeld"}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Environment: {status.environment} · Laatste succesvolle call: {status.lastSuccessfulCallAt ?? "—"}
          </div>
        </div>
        {status.environment !== "mock" && !status.connected && (
          <a href="/api/marktplaats/oauth/authorize" style={{ background: "#f9858b", color: "#fff", padding: "8px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600 }}>
            Opnieuw verbinden
          </a>
        )}
      </div>

      {status.environment === "mock" && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12, padding: "10px 14px", marginBottom: 24, fontSize: 14 }}>
          <b>MOCK MODE</b> — er wordt niets naar Marktplaats gestuurd. Alle templates, mapping, validatie en titel/beschrijving-generatie werken wel volledig.
        </div>
      )}

      <FeedTestPanel />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {products.map((p) => {
          const supported = Boolean(getTemplate(p.product_type));
          return (
            <Link
              key={p.id}
              href={`/admin/${p.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                background: "#fff",
                border: "1px solid #e7e9ec",
                borderRadius: 10,
                padding: "12px 16px",
                textDecoration: "none",
                color: "#1f3049",
              }}
            >
              <span>{p.title}</span>
              <span style={{ fontSize: 12, color: supported ? "#16a34a" : "#dc2626" }}>{supported ? p.product_type : `${p.product_type || "onbekend type"} — geen template`}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
