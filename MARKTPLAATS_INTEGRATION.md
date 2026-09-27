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
   "Test Marktplaats mapping", "Toon Marktplaats payload", "Volledige
   Marktplaats API-test" en "Publiceren op Marktplaats".

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
