# Marketing integraties — iSelectStore

Dit document beschrijft de voorbereiding voor Meta/Facebook, Google en tracking.

## Uitgangspunt

- Geen tracking scripts hardcoded in het theme.
- Geen duplicate pixels.
- Gebruik van **Shopify Customer Events** en officiële Shopify-kanalen.
- Tracking wordt alleen geladen na toestemming (Shopify consent).

## Thema-instellingen

In het Shopify-thema zijn deze velden toegevoegd onder **Thema-instellingen → Marketing & tracking**:

- `meta_pixel_id` — Meta Pixel ID (alleen cijfers).
- `google_analytics_id` — GA4 measurement ID (G-XXXXXXXXXX).
- `google_ads_id` — Google Ads conversion ID (AW-XXXXXXXXXX).

Deze IDs worden gebruikt in custom pixels die je kopieert naar Shopify Admin.

## Meta / Facebook

### Voorbereid in thema

- `snippets/custom-pixel-meta.liquid` bevat de custom-pixel code.
- Kopieer deze code naar **Shopify Admin → Instellingen → Customer Events → Custom pixel toevoegen**.

### Handmatige stappen voor de klant

1. Zorg dat de officiële **Facebook & Instagram sales channel** is geïnstalleerd.
2. Koppel het Meta Business Manager-account.
3. Kies de juiste productcatalogus.
4. Kies de juiste Meta Pixel.
5. Accepteer de vereiste permissions.
6. Vul `meta_pixel_id` in de thema-instellingen in.

## Google

### Voorbereid in thema

- `snippets/custom-pixel-google.liquid` bevat de custom-pixel code voor GA4 + Google Ads.
- Kopieer deze code naar **Shopify Admin → Instellingen → Customer Events → Custom pixel toevoegen**.

### Handmatige stappen voor de klant

1. Installeer de officiële **Google & YouTube** sales channel in Shopify.
2. Koppel het Google Merchant Center.
3. Koppel Google Analytics 4 (GA4).
4. Koppel Google Ads (optioneel).
5. Vul `google_analytics_id` en `google_ads_id` in de thema-instellingen in.

## Tracking / pixels

### Customer Events die worden doorgestuurd

- `page_viewed` → PageView
- `product_viewed` → ViewContent / view_item
- `product_added_to_cart` → AddToCart / add_to_cart
- `checkout_started` → InitiateCheckout / begin_checkout
- `checkout_completed` → Purchase / purchase

### Voorkomen van duplicaten

- Controleer in Shopify Admin onder **Customer Events** welke pixels al actief zijn.
- Gebruik de thema-instellingen om IDs centraal te beheren.
- Geen extra scripts in `theme.liquid` of andere templates.

## Cookie / privacy

- De custom-pixel snippets checken `window.Shopify.customerPrivacy.userCanBeTracked()`.
- Tracking wordt pas geladen nadat de bezoeker toestemming heeft gegeven.
- Voor juridische teksten en cookie-banners: gebruik Shopify's eigen privacy/consent-tools of een geautoriseerde cookie-app.

## Backend

Er is geen backend-logica nodig voor deze marketing-integraties. De backend bevat alleen deze documentatie en de thema-instellingen.
