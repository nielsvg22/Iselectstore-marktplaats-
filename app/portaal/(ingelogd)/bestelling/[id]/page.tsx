// Bestellingdetail = factuurweergave: regels, totalen, adressen,
// track & trace en een print-/PDF-knop. Zoekopdracht: alle bestellingen
// ophalen en op gid matchen (CA API kent geen order-by-id op root).
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  portaalQuery,
  eisInlog,
  vertaalFulfillment,
  vertaalFinancial,
  vertaalAnnulering,
  adresTekst,
  type BestellingenKlant,
} from "../../helpers";
import PrintKnop from "../../PrintKnop";
import { kaart, knoopPrimair, chip, formatEuro, formatDatum, coral, line, muted, navy } from "../../../stijl";

export const dynamic = "force-dynamic";

const BESTELLING_Q = /* GraphQL */ `
  query PortaalBestellingen {
    customer {
      orders(first: 50) {
        nodes {
          id
          name
          number
          processedAt
          cancelledAt
          cancelReason
          financialStatus
          fulfillmentStatus
          currencyCode
          statusPageUrl
          email
          subtotal { amount currencyCode }
          totalPrice { amount currencyCode }
          totalShipping { amount currencyCode }
          totalRefunded { amount currencyCode }
          lineItems(first: 30) {
            nodes {
              id
              name
              title
              variantTitle
              quantity
              sku
              currentTotalPrice { amount currencyCode }
              unitPrice { amount currencyCode }
              image { url }
            }
          }
          shippingAddress {
            formatted
            firstName
            lastName
            address1
            address2
            city
            country
            zip
            phone
          }
          billingAddress {
            formatted
            firstName
            lastName
            address1
            address2
            city
            country
            zip
            phone
          }
          fulfillments(first: 5) {
            nodes {
              status
              trackingInformation { number url company }
            }
          }
        }
      }
    }
  }
`;

function Rij({ label, waarde, vet }: { label: string; waarde: string; vet?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "7px 0",
        fontSize: vet ? 16 : 14,
        fontWeight: vet ? 700 : 400,
        color: vet ? navy : muted,
        borderTop: vet ? `1px solid ${line}` : "none",
      }}
    >
      <span>{label}</span>
      <span style={{ color: navy, whiteSpace: "nowrap" }}>{waarde}</span>
    </div>
  );
}

export default async function BestellingDetail({ params }: { params: { id: string } }) {
  eisInlog();
  let id: string;
  try {
    id = decodeURIComponent(params.id);
  } catch {
    notFound();
    return;
  }

  const { data } = await portaalQuery<BestellingenKlant>(BESTELLING_Q);
  const bestelling = data?.customer?.orders?.nodes.find((b) => b.id === id);
  if (!bestelling) notFound();

  const b = bestelling!;
  const f = vertaalFulfillment(b.fulfillmentStatus);
  const fin = vertaalFinancial(b.financialStatus);
  const annulering = vertaalAnnulering(b.cancelledAt ? b.cancelReason || "CUSTOMER" : null);
  const regels = b.lineItems?.nodes || [];
  const trackings = (b.fulfillments?.nodes || []).flatMap((ff) => ff.trackingInformation || []).filter((t) => t.url || t.number);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="niet-printen" style={{ fontSize: 13, color: muted }}>
        <Link href="/portaal" style={{ color: muted }}>
          ← Bestellingen
        </Link>
      </div>

      {/* Kop */}
      <div style={{ ...kaart, borderRadius: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, color: muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Bestelling</div>
            <h1 style={{ fontSize: 26, margin: "2px 0 4px" }}>{b.name}</h1>
            <div style={{ fontSize: 14, color: muted }}>{formatDatum(b.processedAt)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {annulering ? <span style={chip(coral)}>{annulering}</span> : <span style={chip(f.kleur)}>{f.tekst}</span>}
            <span style={chip(fin.kleur)}>{fin.tekst}</span>
          </div>
        </div>

        <div className="niet-printen" style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <PrintKnop />
          {b.statusPageUrl && (
            <a href={b.statusPageUrl} target="_blank" rel="noreferrer" style={{ ...knoopPrimair }}>
              Volg je bestelling ↗
            </a>
          )}
        </div>
      </div>

      {/* Track & trace */}
      {trackings.length > 0 && (
        <div style={{ ...kaart }}>
          <div style={{ fontSize: 13, color: muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
            Track &amp; trace
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trackings.map((t, i) => (
              <div key={i} style={{ fontSize: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {t.company && <b style={{ color: navy }}>{t.company}</b>}
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" style={{ color: coral, fontWeight: 600 }}>
                    {t.number || "Track & trace"} ↗
                  </a>
                ) : (
                  <span>{t.number}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Factuur */}
      <div style={{ ...kaart }}>
        <div style={{ fontSize: 13, color: muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 }}>
          Factuur — regels
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {regels.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 14,
                padding: "12px 0",
                borderTop: `1px solid ${line}`,
                alignItems: "center",
              }}
            >
              {r.image?.url ? (
                <img
                  src={r.image.url}
                  alt=""
                  width={52}
                  height={52}
                  style={{ objectFit: "contain", background: "#fff", border: `1px solid ${line}`, borderRadius: 10, flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 52, height: 52, border: `1px solid ${line}`, borderRadius: 10, flexShrink: 0 }} />
              )}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, color: navy }}>{r.name || r.title}</div>
                {r.variantTitle && <div style={{ fontSize: 13, color: muted }}>{r.variantTitle}</div>}
                <div style={{ fontSize: 13, color: muted }}>
                  {formatEuro(r.unitPrice?.amount)} × {r.quantity}
                  {r.sku ? ` · ${r.sku}` : ""}
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap" }}>{formatEuro(r.currentTotalPrice?.amount)}</div>
            </div>
          ))}
          {regels.length === 0 && <div style={{ color: muted, fontSize: 14, padding: "10px 0" }}>Geen regels gevonden.</div>}
        </div>

        <div style={{ marginTop: 10, maxWidth: 340, marginLeft: "auto" }}>
          <Rij label="Subtotaal" waarde={formatEuro(b.subtotal?.amount)} />
          <Rij
            label="Verzending"
            waarde={b.totalShipping && parseFloat(b.totalShipping.amount) > 0 ? formatEuro(b.totalShipping.amount) : "Gratis"}
          />
          {b.totalRefunded && parseFloat(b.totalRefunded.amount) > 0 && (
            <Rij label="Terugbetaald" waarde={`− ${formatEuro(b.totalRefunded.amount)}`} />
          )}
          <Rij label="Totaal" waarde={formatEuro(b.totalPrice?.amount)} vet />
        </div>

        <div style={{ fontSize: 12, color: muted, marginTop: 10, textAlign: "right" }}>
          Prijzen in {b.currencyCode || "EUR"} · iSelectStore
          {b.email ? ` · ${b.email}` : ""}
        </div>
      </div>

      {/* Adressen */}
      {(b.shippingAddress || b.billingAddress) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {b.shippingAddress && (
            <div style={{ ...kaart }}>
              <div style={{ fontSize: 13, color: muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
                Verzendadres
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-line", color: navy }}>{adresTekst(b.shippingAddress)}</div>
            </div>
          )}
          {b.billingAddress && (
            <div style={{ ...kaart }}>
              <div style={{ fontSize: 13, color: muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
                Factuuradres
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-line", color: navy }}>{adresTekst(b.billingAddress)}</div>
            </div>
          )}
        </div>
      )}

      <div className="niet-printen" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/portaal" style={{ ...knoopPrimair }}>
          Alle bestellingen
        </Link>
        <a href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ ...knoopPrimair, background: "transparent", color: navy, border: `1px solid ${line}` }}>
          Verder winkelen
        </a>
      </div>
    </div>
  );
}
