import { listProducts } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

interface DiagnosticsPageProps {
  searchParams: Promise<{ password?: string }> | { password?: string };
}

export default async function DiagnosticsPage({ searchParams }: DiagnosticsPageProps) {
  const params = await searchParams;
  const password = params.password;
  const authorized = process.env.ADMIN_PANEL_PASSWORD && password === process.env.ADMIN_PANEL_PASSWORD;

  let productCount = 0;
  let apiError: string | null = null;

  if (authorized) {
    try {
      const products = await listProducts(1);
      productCount = products.length;
    } catch (err) {
      apiError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 22 }}>Diagnostics</h1>
      <p style={{ color: "#6b7280" }}>Status van de app en Shopify-verbinding.</p>

      {!authorized && (
        <form style={{ marginTop: 24 }}>
          <input
            type="password"
            name="password"
            placeholder="Admin wachtwoord"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #e7e9ec", fontSize: 14, marginRight: 8 }}
          />
          <button
            type="submit"
            style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#f9858b", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Toon status
          </button>
        </form>
      )}

      {authorized && (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>Shop domein</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>{process.env.SHOPIFY_STORE_DOMAIN || "niet geconfigureerd"}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>App Client ID</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>{process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID || "niet geconfigureerd"}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>Admin API status</div>
            <div style={{ color: apiError ? "#dc2626" : "#16a34a", fontSize: 14 }}>
              {apiError ? `Fout: ${apiError}` : `Verbonden — ${productCount} product(en) opgehaald`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>Webhook topics</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>products/update, products/create, app/uninstalled</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e9ec", borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>Database</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>{process.env.DATABASE_URL ? "DATABASE_URL gezet" : "DATABASE_URL niet gezet"}</div>
          </div>
        </div>
      )}
    </main>
  );
}
