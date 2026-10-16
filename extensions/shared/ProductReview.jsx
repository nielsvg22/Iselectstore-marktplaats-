/** @jsxImportSource preact */
import { getTemplate } from "../../lib/templates/registry";
import { buildQuickProductTitles } from "../../lib/templates/quickProduct";
import { PhotoSelection } from "./PhotoSelection.jsx";

export function ProductReview({ review, market }) {
  const template = getTemplate(review.productType);
  const titles = buildQuickProductTitles(review.productType, review.values);
  const price = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(review.values.sell_price));
  const missing = template.fields.filter((f) => template.marktplaatsAttributes.includes(f.key) && !review.values[f.key]).map((f) => f.label);
  return (
    <s-stack direction="block" gap="base">
      <s-heading>Controleer je product</s-heading>
      <s-text>Er is nog niets aangemaakt. Controleer de gegevens en bevestig onderaan.</s-text>
      <s-section heading="Overzicht">
        <s-stack direction="block" gap="small">
          <s-text>Shopify: {titles.shopifyTitle}</s-text>
          <s-text>Marktplaats: {titles.marktplaatsTitle}</s-text>
          <s-text>Prijs: {price}</s-text>
          <s-text>Status: {review.status === "active" ? "Actief — zichtbaar in de webshop" : "Concept — nog niet zichtbaar"}</s-text>
          <s-text>Dit maakt een Shopify-product aan; een Marktplaats-advertentie wordt niet geplaatst.</s-text>
        </s-stack>
      </s-section>
      <s-section heading={`Foto's (${review.photos.length})`}>
        <s-text>Foto 1 is de hoofdfoto. Deze volgorde wordt naar Shopify verstuurd.</s-text>
        <PhotoSelection photos={review.photos} readOnly />
      </s-section>
      <s-section heading="Specificaties">
        <s-stack direction="block" gap="small">
          {template.fields.filter((f) => !["sell_price", "new_price"].includes(f.key) && review.values[f.key] !== undefined && review.values[f.key] !== "").map((f) => (
            <s-text key={f.key}>{f.label}: {f.kind === "boolean" ? review.values[f.key] === "true" ? "Ja" : "Nee" : review.values[f.key]}</s-text>
          ))}
        </s-stack>
      </s-section>
      <s-section heading="Marktplaats-kenmerken">
        <s-stack direction="block" gap="small">
          {missing.length ? <s-text>Nog niet ingevuld in de iSelect-template: {missing.join(", ")}.</s-text> : <s-text>De Marktplaats-velden uit de iSelect-template zijn ingevuld.</s-text>}
          {market.loading ? <s-text>Categoriekenmerken controleren…</s-text> : (
            <s-stack direction="block" gap="small">
              <s-text>Bron: {({ live: "live categoriegegevens", cache: "opgeslagen categoriegegevens", mock: "testgegevens — geen live bevestiging", unavailable: "controle niet beschikbaar" })[market.source] || "controle niet beschikbaar"}{market.category ? ` · ${market.category}` : ""}.</s-text>
              {market.message ? <s-text>{market.message}</s-text> : null}
              {market.missingMandatory?.length ? <s-banner tone="warning" heading="Verplichte categoriekenmerken ontbreken">{market.missingMandatory.join(", ")}</s-banner> : null}
              {(market.checks || []).map((c, i) => <s-text key={i}>{c.label}: {c.detail || c.status}</s-text>)}
              <s-text>De definitieve controle voor het plaatsen van een advertentie blijft in Marktplaats controle.</s-text>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-stack>
  );
}
