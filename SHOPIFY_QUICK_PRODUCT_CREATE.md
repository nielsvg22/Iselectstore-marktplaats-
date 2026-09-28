# Snel producten aanmaken/bewerken vanuit iSelect-templates — Admin UI Extension

Twee Shopify Admin UI Extensions waarmee de merchant snel producten aanmaakt en
bewerkt volgens de bestaande iSelect-template-engine. Er is **géén tweede
template- of titellogica** gebouwd: de extension deelt `lib/templates`,
`lib/marktplaats/titleGenerator.ts` en `lib/shopify/metafields.ts` met de
backend (letterlijk dezelfde code, gedeeld via relatieve imports).

## Waar zitten de knoppen?

| Extension | Target | Locatie in Shopify Admin |
|---|---|---|
| `iselect-quick-create` | `admin.product-index.action.render` | Productoverzicht → **More actions → Nieuw product via iSelect template** |
| `iselect-product-details` | `admin.product-details.block.render` | Productdetailpagina → blok **iSelect productgegevens** |

- Beide extensions staan onder `extensions/` en gebruiken `api_version = "2026-07"`.
- Gedeelde UI-code: `extensions/shared/` (formulier, previews, backend-client).
- Merchant-naam/lokalisatie: `extensions/*/locales/*.json` (`name`-sleutel).

## Wat doet het formulier?

- **Producttype-select** → veldlijst komt 1-op-1 uit `PRODUCT_TEMPLATES` (registry).
- **Defaults** via `applyTemplateDefaults()` (bijv. abonnement, garantie).
- **Live titelpreviews** tijdens het typen: `buildQuickProductTitles()` toont
  exact dezelfde Shopify- en Marktplaats-titel als de bestaande flows.
- **Validatie per veld** via `validateQuickProductData()` (verplichte velden,
  getallen, select-opties) — client én server doen dezelfde check.
- **Status**: concept (draft) of actief (active), standaard `draft`.
- **Beeldupload** (DropZone) optioneel, direct na create of vanuit het blok.

## Backend-endpoints

Alle vier onder `app/api/shopify/`, authenticatie met de Shopify **id-token**
(`Authorization: Bearer <token>`), CORS via `lib/http/extensionCors.ts`
(allowlist: app-URL, store-domein, `CORS_ORIGINS` + `*.myshopify.com` /
`*.shopify.com` / `*.shopifycloud.com` / `*.shopifydev.com`).

| Endpoint | Methode | Body / query | Doel |
|---|---|---|---|
| `/api/shopify/quick-create` | POST | `{productType, status, values}` | Product aanmaken |
| `/api/shopify/quick-update` | POST | `{productId, productType, values}` | Bestaand product bijwerken |
| `/api/shopify/quick-product` | GET | `?id=<gid of nummer>` | Huidige waarden/titels/status lezen |
| `/api/shopify/quick-image` | POST | `{productId, filename, data(base64)}` | Afbeelding toevoegen |

### idToken-verificatie (`lib/auth/idToken.ts`)

- HS256, ondertekend met `SHOPIFY_APP_CLIENT_SECRET` (fallback
  `SHOPIFY_CLIENT_SECRET`).
- Checks: `exp`/`nbf`, `aud` == client-id (`SHOPIFY_APP_CLIENT_ID` /
  `SHOPIFY_CLIENT_ID`), `iss`-host == `dest`-host, `dest`-host ==
  `SHOPIFY_STORE_DOMAIN`.
- De extension haalt het token op met `shopify.auth.idToken()`.

Geen nieuwe env-variabelen en **geen nieuwe scopes** nodig
(`write_products` stond al in `shopify.app.toml`).

## Wat wordt er precies weggeschreven?

`services/shopify/quickProductService.ts` (dezelfde conventies als het
bestaande admin/AI-pad):

- Titel = schone Shopify-titel (geen batterij/garantie), `product_type`,
  vendor `iSelectStore`, tags `"<type>, pre-owned"`.
- Variant: `price` = `mkt.sell_price`, `compare_at_price` = `mkt.new_price`,
  `inventory_quantity: 1`, `inventory_policy: deny`, `requires_shipping`,
  `taxable`, `fulfillment_service: manual`, `inventory_management: shopify`.
- Metafields: alle templatevelden naar namespace `mkt`
  (`app--428689915905--mkt`), plus storefront-mirror naar `custom` voor
  `storage_gb`, `battery_percentage`, `condition`, `warranty_months`
  (bestaande upsert via `setProductMetafields()` in `lib/shopify/client.ts`).
- `quick-update` bewaart de tagconventie bij een type-wijziging en gebruikt de
  variant als bron van waarheid voor de prijs.
- Elke actie wordt gelogd met `logSync()` (`quick_create` / `quick_update` /
  `quick_image`).

### Beeldupload (limiet)

- Client: bestanden → base64 (`extensions/shared/api.js`).
- Server: max **3 MB** per afbeelding, alleen `jpg/png/webp/gif`, plus
  magic-byte-check dat de header bij de extensie past
  (`addQuickProductImage()`).

## Testscenario's

- **A — endpoint-tests**: `__tests__/quickCreateRoute.test.ts` (idToken,
  foutafhandeling 400/401, draft/active, voorraad=1, metafields) +
  `__tests__/quickProductService.test.ts`.
- **B — templates/titels**: `__tests__/quickProduct.test.ts` (validatie per
  type, defaults, volledige `LIVE_TYPES`-map, titel-parity, geen
  duplicatie van de engine).
- **C — beeldupload**: server-limit tests in `quickProductService.test.ts`
  (3 MB, extensie, magic bytes).
- **D — bestaand pad onaangetast**: `__tests__/productIdentity.test.ts`,
  `soldImage.*`, `ai.*`, `titleGenerator.test.ts` draaien ongewijzigd mee;
  gewijzigde bestanden zijn alleen de geplande (zie git-status).

Uitvoeren: `npm run typecheck && npm run lint && npm test`.

## Lokaal ontwikkelen

```bash
npx shopify app dev --store <domein>     # tunnel + extensions bundelen
```

Let op: `.shopify/project.json` verwijst naar `iselectstore-dev.myshopify.com`;
als die store niet (meer) in de Partner-organisatie staat, koppelen met
`shopify app config link` of een andere store opgeven. Bundling is ook los te
checken met esbuild (entry = `extensions/*/src/*.jsx`).

## Deploy

1. Backend: commit + push naar
   `https://github.com/nielsvg22/Iselectstore-marktplaats-.git` → Vercel
   (`https://iselectstore-marktplaats-app.vercel.app`).
2. Extensions: `npx shopify app deploy` (uploadt beide extensions naar de
   Partner-app; daarna beschikbaar in de Admin van geïnstalleerde stores).

## E2E-check na deploy (curl)

Een idToken is HS256 met de app-secret — lokaal naspeelbaar zonder browser:

```bash
node -e '
const {createHmac}=require("crypto");
const secret=process.env.SHOPIFY_APP_CLIENT_SECRET;
const dest="https://ggh8q9-v1.myshopify.com";
const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"});
const now=Math.floor(Date.now()/1000);
const p=b({iss:dest+"/admin",dest,aud:"db247c0b3b7c65f9b5d8d798ae30b925",sub:"e2e",exp:now+300,nbf:now-60});
console.log(`${h}.${p}.${createHmac("sha256",secret).update(`${h}.${p}`).digest("base64url")}`);'
```

```bash
TOKEN="..."   # bovenstaande output
curl -sS -X POST https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"productType":"iPhone","status":"draft","values":{"model":"iPhone 15","storage_gb":"128","color":"Zwart","condition":"Als nieuw","sell_price":"499"}}'
```

Verifieer daarna met de Admin REST (`SHOPIFY_ADMIN_ACCESS_TOKEN`):
`inventory_quantity == 1`, vendor/tags, metafields `mkt.*` + `custom.*`, en
ruim het testproduct weer op (`DELETE /admin/api/2024-10/products/<id>.json`).

## Wat is bewust niet aangeraakt?

- Marktplaats-publishflow (`lib/marktplaats/orchestrator.ts`), prijs komt
  ook nu uit `product.variants[0].price`.
- Voorraadmeldingen, sold-image, lifecycle/AI-flow, admin-panel, thema.
- Bestaande AI-apply/`setStructuredField`-pad in `lib/shopify/client.ts`.
