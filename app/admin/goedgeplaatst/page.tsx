import Link from "next/link";
import { GoedgeplaatstPanel } from "./GoedgeplaatstPanel";

export const dynamic = "force-dynamic";

export default function GoedgeplaatstAdminPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <Link href="/admin" style={{ color: "#6b7280", fontSize: 13 }}>
        ← Terug naar overzicht
      </Link>
      <h1 style={{ fontSize: 22, marginTop: 8, marginBottom: 4 }}>GoedGeplaatst API</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Officiële, TWEEDE plaatsingsmethode naast de bestaande Playwright-test en de Admarkt-feed — nog uitsluitend conceptadvertenties,
        nooit publicatie.
      </p>
      <GoedgeplaatstPanel />
    </main>
  );
}
