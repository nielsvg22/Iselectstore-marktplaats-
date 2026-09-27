import Link from "next/link";
import { getSoldImageSettings } from "@/lib/soldImage/settingsService";
import { SoldImageSettingsForm } from "./SoldImageSettingsForm";

export const dynamic = "force-dynamic";

export default async function SoldImagesSettingsPage() {
  const settings = await getSoldImageSettings();

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
      <Link href="/admin" style={{ color: "#6b7280", fontSize: 13 }}>
        ← Terug naar overzicht
      </Link>
      <h1 style={{ fontSize: 22, marginTop: 8 }}>VERKOCHT-sticker instellingen</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Wanneer een product uitverkocht raakt, kan hier automatisch een VERKOCHT-versie van de eerste productfoto
        gemaakt worden. De originele foto blijft altijd bewaard en wordt hersteld zodra het product weer op voorraad
        komt.
      </p>
      <SoldImageSettingsForm initial={settings} />
    </main>
  );
}
