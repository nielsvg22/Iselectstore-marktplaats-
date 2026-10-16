// Foutmelding na een mislukte Customer Account API-login, met herstelknop.
import Link from "next/link";
import { kaart, knoopPrimair, knoopGhost, navy, coral } from "../../stijl";

export const dynamic = "force-dynamic";

const BERICHTEN: Record<string, { titel: string; tekst: string }> = {
  state: {
    titel: "Veiligheidscontrole mislukt",
    tekst: "Je sessie was verlopen voordat de login klaar was. Probeer het opnieuw — je hoeft waarschijnlijk niets opnieuw in te vullen.",
  },
  token: {
    titel: "Inloggen niet gelukt",
    tekst: "Shopify heeft geen geldige sessietoken gegeven. Probeer het opnieuw; lukt het opnieuw niet, neem dan contact met ons op.",
  },
  geweigerd: {
    titel: "Inloggen geannuleerd",
    tekst: "Je hebt het inloggen afgebroken. Je kunt het op elk moment opnieuw proberen.",
  },
  discover: {
    titel: "Winkel even niet bereikbaar",
    tekst: "De verbinding met de winkel is tijdelijk niet beschikbaar. Probeer het over een moment opnieuw.",
  },
};

export default function InlogFout({ searchParams }: { searchParams: { m?: string } }) {
  const m = BERICHTEN[searchParams.m || ""] || {
    titel: "Er ging iets mis",
    tekst: "Het inloggen is niet gelukt. Probeer het opnieuw.",
  };

  return (
    <div style={{ maxWidth: 520, margin: "8vh auto 0" }}>
      <div style={{ ...kaart, textAlign: "center", padding: "34px 28px" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${coral}1a`, color: coral, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 14px", fontWeight: 700 }}>
          !
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px", color: navy }}>{m.titel}</h1>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: "0 0 22px" }}>{m.tekst}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/portaal/inloggen" style={{ ...knoopPrimair }}>
            Opnieuw proberen
          </Link>
          <Link href="/" style={{ ...knoopGhost }}>
            Naar de webshop
          </Link>
        </div>
      </div>
    </div>
  );
}
