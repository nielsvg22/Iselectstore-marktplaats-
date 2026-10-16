// Profiel + adressen (alleen-lezen; wijzigen via de webshop/support).
import Link from "next/link";
import { portaalQuery, eisInlog, adresTekst, type GegevensKlant } from "../helpers";
import { kaart, knoopGhost, chip, labelStijl, coral, line, muted, navy } from "../../stijl";

export const dynamic = "force-dynamic";

const GEGEVENS_Q = /* GraphQL */ `
  query PortaalGegevens {
    customer {
      id
      firstName
      lastName
      displayName
      emailAddress { emailAddress }
      phoneNumber { phoneNumber }
      defaultAddress { id }
      addresses(first: 10) {
        nodes {
          id
          firstName
          lastName
          company
          address1
          address2
          city
          country
          countryCode
          zip
          phone
          formatted
        }
      }
    }
  }
`;

export default async function PortaalGegevens() {
  eisInlog();
  const { data, fieldErrors } = await portaalQuery<GegevensKlant>(GEGEVENS_Q);
  const klant = data?.customer;
  if (!klant) return null;

  const adressen = klant.addresses?.nodes || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Mijn gegevens</h1>
        <p style={{ color: muted, fontSize: 14, margin: 0 }}>Je profiel- en adresgegevens zoals bekend bij iSelectStore.</p>
      </div>

      {fieldErrors.length > 0 && (
        <div style={{ ...kaart, borderColor: `${coral}55`, background: `${coral}0a`, fontSize: 13 }}>
          <b>Sommige velden zijn beperkt:</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: muted }}>
            {fieldErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ ...kaart }}>
        <div style={{ ...labelStijl }}>Profiel</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 15 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{klant.displayName}</div>
            <div style={{ color: muted, fontSize: 14 }}>{klant.emailAddress?.emailAddress || "—"}</div>
          </div>
          <div>
            <div style={{ ...labelStijl, marginBottom: 2 }}>Telefoon</div>
            <div style={{ fontSize: 14 }}>{klant.phoneNumber?.phoneNumber || "—"}</div>
          </div>
        </div>
        <div style={{ marginTop: 16, fontSize: 13, color: muted, lineHeight: 1.6 }}>
          Wijzigen kan via de webshop bij je volgende bestelling, of neem{" "}
          <Link href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ color: navy }}>
            contact met ons op
          </Link>
          .
        </div>
      </div>

      <h2 style={{ fontSize: 17, margin: "6px 0 -4px" }}>Adressen</h2>

      {adressen.length === 0 ? (
        <div style={{ ...kaart, textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Nog geen adressen opgeslagen</div>
          <p style={{ color: muted, fontSize: 14, margin: "0 0 14px" }}>
            Je adressen worden automatisch bewaard zodra je een bestelling plaatst.
          </p>
          <a href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ ...knoopGhost }}>
            Naar de webshop
          </a>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {adressen.map((a) => {
            const isDefault = klant.defaultAddress?.id === a.id;
            const naam = [a.firstName, a.lastName].filter(Boolean).join(" ") || klant.displayName;
            return (
              <div key={a.id} style={{ ...kaart, position: "relative" }}>
                {isDefault && (
                  <span style={{ ...chip(navy), position: "absolute", top: 12, right: 12 }}>Standaard</span>
                )}
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{naam}</div>
                <div style={{ fontSize: 14, color: muted, lineHeight: 1.65, whiteSpace: "pre-line" }}>
                  {adresTekst(a)}
                </div>
                {a.phone && <div style={{ fontSize: 13, color: muted, marginTop: 6 }}>📞 {a.phone}</div>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...kaart, background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Bestellingen bekijken</div>
          <div style={{ fontSize: 13, color: muted }}>Factuur en track &amp; trace per bestelling.</div>
        </div>
        <Link href="/portaal" style={{ ...knoopGhost }}>
          Naar bestellingen
        </Link>
      </div>

      <div style={{ borderTop: `1px solid ${line}`, paddingTop: 14, fontSize: 13 }}>
        <Link href="/portaal/uitloggen" style={{ color: coral, fontWeight: 600, textDecoration: "none" }}>
          Uitloggen
        </Link>
      </div>
    </div>
  );
}
