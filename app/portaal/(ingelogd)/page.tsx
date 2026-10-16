// Portaal-overzicht: welkomstkaart + bestellingenlijst (nieuwste eerst).
import Link from "next/link";
import { portaalQuery, eisInlog, vertaalFulfillment, vertaalFinancial, vertaalAnnulering, type OverzichtKlant } from "./helpers";
import { kaart, knoopPrimair, chip, formatEuro, formatDatum, coral, line, muted, navy } from "../stijl";

export const dynamic = "force-dynamic";

const OVERZICHT_Q = /* GraphQL */ `
  query PortaalOverzicht {
    customer {
      id
      firstName
      lastName
      displayName
      emailAddress { emailAddress }
      orders(first: 50) {
        nodes {
          id
          name
          processedAt
          cancelledAt
          financialStatus
          fulfillmentStatus
          totalPrice { amount currencyCode }
        }
      }
    }
  }
`;

export default async function PortaalOverzicht() {
  eisInlog();
  const { data, fieldErrors } = await portaalQuery<OverzichtKlant>(OVERZICHT_Q);
  const klant = data?.customer;

  if (!klant) {
    // Token geldig maar geen klantprofiel (bijv. account verwijderd).
    return (
      <div style={{ ...kaart, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Account niet gevonden</h1>
        <p style={{ color: muted, fontSize: 14 }}>Je sessie is geldig, maar er is geen klantaccount gekoppeld. Log opnieuw in of neem contact op.</p>
        <Link href="/portaal/uitloggen" style={{ ...knoopPrimair, marginTop: 8 }}>
          Opnieuw inloggen
        </Link>
      </div>
    );
  }

  const bestellingen = [...(klant.orders?.nodes || [])].sort((a, b) =>
    (b.processedAt || "").localeCompare(a.processedAt || "")
  );
  const naam = klant.displayName || klant.emailAddress?.emailAddress || "welkom";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ ...kaart, background: navy, border: "none", color: "#fff", borderRadius: 20 }}>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>Mijn account</div>
        <h1 style={{ fontSize: 24, margin: "0 0 6px", fontWeight: 700 }}>{naam}</h1>
        <div style={{ fontSize: 14, opacity: 0.85 }}>
          {klant.emailAddress?.emailAddress} · {bestellingen.length} {bestellingen.length === 1 ? "bestelling" : "bestellingen"}
        </div>
      </div>

      {fieldErrors.length > 0 && (
        <div style={{ ...kaart, borderColor: `${coral}55`, background: `${coral}0a`, fontSize: 13, color: navy }}>
          <b>Let op:</b> sommige gegevens konden niet worden opgehaald. {fieldErrors[0]}
        </div>
      )}

      <h2 style={{ fontSize: 17, margin: "6px 0 -4px" }}>Bestellingen</h2>

      {bestellingen.length === 0 ? (
        <div style={{ ...kaart, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📦</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Nog geen bestellingen</div>
          <p style={{ color: muted, fontSize: 14, margin: "0 0 18px", lineHeight: 1.6 }}>
            Zodra je iets besteld hebt, verschijnt je bestelling hier met factuur en track &amp; trace.
          </p>
          <a href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ ...knoopPrimair }}>
            Naar de webshop
          </a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {bestellingen.map((b) => {
            const f = vertaalFulfillment(b.fulfillmentStatus);
            const fin = vertaalFinancial(b.financialStatus);
            const annulering = vertaalAnnulering(b.cancelledAt ? "CUSTOMER" : null);
            return (
              <Link
                key={b.id}
                href={`/portaal/bestelling/${encodeURIComponent(b.id)}`}
                style={{
                  ...kaart,
                  textDecoration: "none",
                  color: navy,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                  transition: "border-color .15s",
                }}
              >
                <div style={{ flex: "1 1 180px" }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{b.name}</div>
                  <div style={{ fontSize: 13, color: muted }}>{formatDatum(b.processedAt)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {annulering ? <span style={chip(coral)}>{annulering}</span> : <span style={chip(f.kleur)}>{f.tekst}</span>}
                  <span style={chip(fin.kleur)}>{fin.tekst}</span>
                </div>
                <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>
                  {formatEuro(b.totalPrice?.amount)}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/portaal/gegevens" style={{ ...knoopPrimair, background: "transparent", color: navy, border: `1px solid ${line}` }}>
          Mijn gegevens &amp; adressen
        </Link>
        <a href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ ...knoopPrimair }}>
          Verder winkelen
        </a>
      </div>
    </div>
  );
}
