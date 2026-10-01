# Marktplaats-integratie — iSelectStore

Shopify → Marktplaats.nl publicatie-app. Shopify blijft de **source of truth**;
deze app is de vertaler/verzender ertussenin.

## Architectuur

```
Shopify (Admin API, mkt.* metafields)
        │
        ▼
Next.js app (dit project — Vercel)
  ├─ Producttemplate-engine (lib/templates)
  ├─ Marktplaats mapping-engine (lib/marktplaats/mappingEngine.ts)
  ├─ Title/description generators
  ├─ Preflight validator
  ├─ Marktplaats API client (echt + mock)
  └─ Admin-paneel (/admin)
        │
        ▼
Marktplaats API v2 (auth.marktplaats.nl + api.marktplaats.nl)
```

Neon Postgres bewaart: category mappings, attribute mappings, attribute
cache (TTL), product-status, sync-log, integration-test records, connectie-
status (token, environment).

## Dataflow

1. Gebruiker vult in Shopify (via de `mkt.*` metafields) één keer de
   structured product data in — per producttype andere velden (zie
   `lib/templates/registry.ts`).
2. `buildProductPreview()` (`lib/marktplaats/orchestrator.ts`) leest het
   Shopify-product + metafields, bepaalt het producttemplate, haalt de
   Marktplaats-categorie en (live of mock) category-attributes op, voert de
   mapping en preflight-validatie uit, en genereert titel + beschrijving.
3. De admin-UI (`/admin/[productId]`) toont dit alles en biedt de knoppen
   "Test Marktplaats mapping", "Toon Marktplaats payload", "Voorbeeld
   advertentie", "Test op Marktplaats", "Volledige Marktplaats API-test" en
   "Publiceren via API".

## Producttemplates

Zes producttypes, elk met eigen velden/mapping (`lib/templates/registry.ts`):
iPhone, iPad, MacBook, iMac, Mac mini, Apple Watch.

Regel: `shopifyTitleFields` bevat **nooit** batterijconditie of garantie —
die staan als aparte kenmerken (`shopifyFeatureFields`) en worden alleen aan
de **Marktplaats**-titel toegevoegd (`marktplaatsTitleExtraFields`).

## Shopify metafields

Namespace `mkt`, key = de veldnaam uit `FIELD_LIBRARY`
(`lib/templates/types.ts`), bv. `mkt.ram_gb`, `mkt.battery_percentage`,
`mkt.condition`. Daarnaast twee override-velden per product (opgeslagen in
de `marktplaats_product`-tabel, niet in Shopify): `custom_title`,
`custom_description`.

## Marktplaats OAuth

- **Client-token** (`client_credentials`): alleen publieke/client-scoped
  endpoints — categorieën, category-attributes.
- **User-token** (`authorization_code`): verplicht om daadwerkelijk een
  advertentie te plaatsen/wijzigen/verwijderen — gekoppeld aan het echte
  verkopersaccount. Flow: `/api/marktplaats/oauth/authorize` →
  Marktplaats-consent → `/api/marktplaats/oauth/callback` (state-check,
  token-opslag in `marktplaats_connection`).

Endpoints geverifieerd tegen de officiële docs (27-09-2026):
- Token: `https://auth.marktplaats.nl/accounts/oauth/token` (sandbox:
  `https://auth.demo.qa-mp.so/accounts/oauth/token`)
- Categories: `GET /v2/categories`
- Category attributes: `GET /v2/categories/{l1}/{l2}/attributes`
- Advertisement: `POST/GET/PUT/PATCH/DELETE /v2/advertisements[/{itemId}]`

**Nog niet geverifieerd / te bevestigen bij Marktplaats support:**
- Exact `/authorize`-pad voor de authorization-code flow (alleen het
  token-endpoint stond in de door ons opgehaalde doc-excerpt).
- De publieke API-basis-URL voor `sandbox` (alleen de auth-host voor sandbox
  is gedocumenteerd teruggevonden).
- Vereiste OAuth scopes om te mogen publiceren.
- Het exacte formaat van `/v2/advertisements/{itemId}/images`.

## Environments

- `MARKTPLAATS_ENVIRONMENT=mock` (default): geen enkele echte call, alles
  (templates, mapping, validatie, titel/beschrijving, payload-preview,
  full-test-flow) werkt met een lokale mock-attribuutset (`lib/marktplaats/mock.ts`,
  attribuutsleutels altijd geprefixt `mock_` zodat ze nooit met echte
  Marktplaats-attributen verward kunnen worden).
- `MARKTPLAATS_ENVIRONMENT=sandbox`: officieel gedocumenteerd
  sandbox-auth-endpoint bestaat — gebruik pas na bevestiging van Marktplaats
  dat onze credentials daar toegang toe hebben.
- `MARKTPLAATS_ENVIRONMENT=production`: echte advertenties.

## Category mapping

Tabel `marktplaats_category_mapping`. Zes rijen geseed (iPhone, iPad,
MacBook, iMac, Mac mini, Apple Watch) met `l1CategoryId`/`l2CategoryId` =
`"UNVERIFIED"` — bewust geen verzonnen numerieke ID's (regel: nooit
attributen/categorieën verzinnen). Zodra er credentials zijn: haal
`GET /v2/categories` op, zoek de juiste L1/L2, en werk de rij bij via
`upsertCategoryMapping()`.

## Attribute mapping & cache

- `marktplaats_attribute_cache`: TTL-cache per L2-categorie
  (`getCategoryAttributes()`, `forceRefresh` optie voor handmatige refresh).
- `marktplaats_attribute_mapping`: internal field → Marktplaats attribute
  key, per L2-categorie (category-aware, nooit één globale mapping).
- Nu geseed: `model`/`watch_series` → `mock_model`, `color` → `mock_kleur`
  (alleen voor de mock-categorie `UNVERIFIED`). RAM/opslag zijn bewust nog
  niet gemapt — dat toont de "geen matchend attribuut"-waarschuwing in de
  validator totdat de echte Marktplaats-attribuutsleutels bekend zijn.

## Logging

`marktplaats_sync_log` — actie, API-operatie, HTTP-status, foutcode,
timestamp. **Nooit** tokens/secrets. `humanizeError()` (`lib/logging.ts`)
vertaalt bekende foutpatronen naar begrijpelijke taal voor de beheerder.

## Sold / voorraad 0

`handleSoldOutOfStock()` (`lib/marktplaats/publishService.ts`) zet status op
`sold`, en sluit de advertentie alleen direct als `sold_behavior =
close_immediately`. Bij `manual` of `keep_days` blijft de advertentie
gewoon live — een geplande job om `keep_days`-advertenties na X dagen te
sluiten is **nog niet gebouwd** (zie "Bekende beperkingen").

## Bekende beperkingen

- Geen echte Marktplaats-credentials aanwezig → alles is tot en met mock/
  sandbox-niveau gebouwd en getest; live publiceren is niet uitgevoerd.
- Category-ID's zijn `UNVERIFIED` totdat de echte Marktplaats-categorieën
  zijn opgehaald.
- Alleen `model`/`watch_series`/`color` hebben een attribute-mapping; overige
  velden (RAM, opslag, chip, kleur-varianten, etc.) moeten gemapt worden
  zodra de echte category-attributes bekend zijn.
- Geen geautomatiseerde cron voor `keep_days` sold-advertenties of voor
  periodieke `update_required`-detectie — dit draait nu alleen wanneer de
  admin op "Test mapping" of "Publiceren" klikt.
- Geen echte KMS-encryptie voor het opgeslagen user-token (nu base64 —
  functioneel maar geen echte encryptie, zie `connectionService.ts`).
- Sold-overlay op de eerste afbeelding (FASE 41) is niet gebouwd, alleen
  de architectuur (status `sold`) is voorbereid.
- AI-fotoherkenning (FASE 43) is niet gebouwd; structured fields zijn wel
  klaar om later door zo'n service ingevuld te worden.

## Stappen: eerste iPhone-test (mock)

1. `npm run dev` (of open de Vercel-deployment).
2. Zorg dat het Shopify-product producttype `iPhone` heeft en metafields
   `mkt.model`, `mkt.storage_gb`, `mkt.color` (en optioneel
   `mkt.battery_percentage`, `mkt.warranty_months`) zijn ingevuld.
3. Ga naar `/admin/{shopify_product_id}`.
4. Klik "Test Marktplaats mapping" → controleer titel, beschrijving,
   kenmerken en preflight-validatie.

## Stappen: eerste MacBook-test (mock)

Zelfde als hierboven, met producttype `MacBook` en metafields `mkt.model`,
`mkt.chip`, `mkt.ram_gb`, `mkt.storage_gb`, `mkt.screen_size`.

## Stappen: "Test Marktplaats mapping" gebruiken

`/admin/{productId}` → knop "Test Marktplaats mapping". Publiceert niets;
toont per veld Shopify-waarde → Marktplaats-attribuut + status.

## Stappen: "Volledige Marktplaats API-test" gebruiken

`/admin/{productId}` → knop "Volledige Marktplaats API-test". In mock mode:
volledige publish → retrieve → compare → cleanup-flow met een `mock-...`
advertentie-ID, niets verlaat de server. In live mode: vereist een
gekoppeld Marktplaats-account (user-token) via "Opnieuw verbinden".

## Browser-test (Playwright) — tijdelijke mapping-verificatie, geen productiepad

Zolang er nog geen bruikbare officiële Marktplaats API-toegang is, kun je de
veldmapping verifiëren tegen het **echte** marktplaats.nl-formulier met de
knop "Test op Marktplaats" op `/admin/{productId}`. Dit is uitdrukkelijk
**geen vervanging** van de toekomstige officiële API-publicatie
(`lib/marktplaats/apiPublisher.ts`) — beide routes draaien op exact dezelfde
advertisement-data, nooit twee keer gebouwd.

**Architectuur (drie publishers, één datamodel)**

- `lib/marktplaats/service.ts` → `MarktplaatsService` met
  `buildAdvertisement()` / `validateAdvertisement()`. Bouwt de
  `AdvertisementDraft` (titel, prijs, categorie, velden, afbeeldingen) uit
  `buildProductPreview()` — **de** gedeelde bron voor beide routes.
- `lib/marktplaats/apiPublisher.ts` → `MarktplaatsApiPublisher`: de
  officiële API-route (nu nog mock/sandbox; hier komt de echte API zodra
  Marktplaats toegang verleent).
- `lib/marktplaats/browserTest/browserTestPublisher.ts` →
  `MarktplaatsBrowserTestPublisher`: Playwright, **alleen testdoeleinden**.
  Opent de echte plaatsingspagina, vult velden in, uploadt afbeeldingen en
  **stopt altijd** vóór de definitieve plaatsingsactie.

**Ondersteunende modules** (allen in `lib/marktplaats/browserTest/`):

- `config.ts` — env-config + de **harde** submit-guard
  (`assertSubmitAllowed()` / `stopBeforeSubmit()`).
- `selectors.ts` — volgorde van robuuste selectors per veld
  (label → role → placeholder → data-testid → CSS/XPath als fallback).
- `status.ts` — in-memory run/statusstore voor de live debug-uitvoer in de UI.
- `session.ts` — één persistent browservenster dat over runs heen blijft.
- `imageStore.ts` — downloadt Shopify-afbeeldingen naar een tijdelijke map
  (opgeruimd na afloop) zodat Playwright echte bestanden kan uploaden.

**Lokaal (`npm run dev`) of op een eigen VPS via Coolify** — nooit op
Vercel: dat heeft geen scherm en elke functie-aanroep start in een nieuw,
leeg containertje. Playwright is server-side en staat in
`serverComponentsExternalPackages`, dus nooit in de client-bundle.

### Coolify-deployment (zichtbare browser via noVNC)

`Dockerfile` + `docker/entrypoint.sh` draaien de app **en** een zichtbare
Chromium-sessie in dezelfde container: Xvfb (virtueel scherm) + x11vnc +
noVNC, zodat je de browser gewoon in een webpagina bekijkt en erin kan
inloggen — iets wat lokaal draaien ook doet, maar dan vanaf een always-on
VPS in plaats van je eigen laptop.

- **Poort 3000** — de Next.js-app zelf (zelfde image, los van de Vercel-deploy).
- **Poort 6080** — noVNC-webclient (`/vnc.html`), toont het live Chromium-venster.
  Vereist `VNC_PASSWORD` als env-var — de container weigert te starten zonder.
- **Non-root user** (`app`) i.p.v. `--no-sandbox`, zodat Chromium's eigen
  sandbox intact blijft (`lib/marktplaats/browserTest/browserTestPublisher.ts`
  is hiervoor niet aangepast).
- `MARKTPLAATS_BROWSER_PROFILE_DIR=/data/marktplaats-browser-profile` en
  `MARKTPLAATS_BROWSER_DEBUG_DIR=/data/marktplaats-debug` — zet `/data` als
  persistent volume in Coolify zodat de login-sessie een herdeploy overleeft
  (zonder volume overleeft de sessie alleen een gewone restart van dezelfde
  container, niet een nieuwe build).
- Zet de noVNC-pagina (poort 6080) achter een eigen, afgeschermd (sub)domein
  — dit is een live, ingelogde Marktplaats-sessie; behandel de URL + VNC-
  wachtwoord als een credential.

**Environment-variabelen** (zie `.env.example`):

- `MARKTPLAATS_BROWSER_TEST=true` — zet lokaal in `.env.local` om de knop te
  activeren (API-route geeft 403 zolang dit niet "true" is).
- `MARKTPLAATS_BROWSER_ALLOW_SUBMIT=false` — **harde guard**. Zolang dit niet
  expliciet `true` is, wordt de plaatsingsknop nooit aangeklikt; de flow
  stopt op de controlepagina en de browser blijft open.
- `MARKTPLAATS_BROWSER_PLACEMENT_URL` — standaard
  `https://www.marktplaats.nl/plaats`.
- `MARKTPLAATS_BROWSER_PROFILE_DIR` / `MARKTPLAATS_BROWSER_DEBUG_DIR` —
  persistent browserprofiel (login/cookies) en screenshot/HTML-debug-output,
  standaard onder `.playwright/` — staat in `.gitignore`, nooit committen.
- Optioneel: `MARKTPLAATS_BROWSER_HEADLESS`, `MARKTPLAATS_BROWSER_CHANNEL`
  (bv. `chrome`), `MARKTPLAATS_BROWSER_LOGIN_TIMEOUT_MS`,
  `MARKTPLAATS_BROWSER_NAV_TIMEOUT_MS`, `MARKTPLAATS_BROWSER_MAX_IMAGES`.

**Login**: geen inloggegevens worden ooit gelezen, opgeslagen of gecommit.
Bij de eerste run (of een verlopen sessie) zet de run-status zichzelf op
`waiting_login`, wacht tot je handmatig bent ingelogd in het geopende
venster, en gaat dan verder — die sessie blijft daarna bewaard in het
lokale profiel.

**Velden/selectors** staan in `selectors.ts` en zijn bewust generiek
(label/role-gebaseerd; CSS/XPath alleen als laatste fallback). Labels waarvan
we vermoeden dat de echte pagina een andere tekst gebruikt staan in
`FIELD_LABEL_ALIASES` — pas deze aan zodra je de werkelijke pagina hebt
gezien. Een veld dat niet gevonden wordt crasht de hele run niet: het komt
terug als "⚠ niet gevonden" en de overige velden worden gewoon geprobeerd.

**Resultaatweergave**: de UI pollt `/api/marktplaats/browser-test?runId=…`
en toont per veld ✓ (ingevuld), ⚠ (niet gevonden), ✗ (fout) of ℹ
(informatie), plus een duidelijke melding wanneer de run gestopt is vóór
publicatie.

## Stappen: eerste echte advertentie publiceren

1. Vraag een Marktplaats-verkopersaccount met API-toegang aan; vul
   `MARKTPLAATS_CLIENT_ID`/`MARKTPLAATS_CLIENT_SECRET`/`MARKTPLAATS_REDIRECT_URI`
   in de Vercel-environment-variabelen.
2. Zet `MARKTPLAATS_ENVIRONMENT=sandbox` (na bevestiging door Marktplaats
   dat sandbox-toegang bestaat voor onze credentials) of `production`.
3. Klik "Opnieuw verbinden" op `/admin` → rond de Marktplaats-login/consent
   af.
4. Werk `marktplaats_category_mapping` bij met de echte L1/L2 category-ID's
   (via `GET /v2/categories`).
5. Werk `marktplaats_attribute_mapping` bij met de echte attribute keys (via
   "Test Marktplaats mapping" — ontbrekende mappings worden expliciet
   getoond).
6. Klik "Test Marktplaats mapping" tot de preflight-validatie volledig ✅ is.
7. Klik "Publiceren op Marktplaats".
