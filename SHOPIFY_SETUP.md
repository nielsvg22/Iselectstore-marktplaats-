# Shopify setup — iSelectStore backend

Dit document beschrijft de Shopify-app setup voor de Next.js/Vercel-backend.

## Architectuur

- **App type:** Custom Next.js 14-app op Vercel (geen officiële Shopify CLI-app-template).
- **App in Shopify Partners:** `Beheer` (Client ID `db247c0b3b7c65f9b5d8d798ae30b925`).
- **Configuratiebestand:** `shopify.app.toml` (aanwezig in repo-root).
- **Authenticatie:**
  - App-installatie/OAuth via `/api/auth` en `/api/auth/callback`.
  - Server-side Admin API-calls via `SHOPIFY_ADMIN_ACCESS_TOKEN`.

## Vereiste environment variables

```bash
# Shopify app OAuth
SHOPIFY_CLIENT_ID=db247c0b3b7c65f9b5d8d798ae30b925
SHOPIFY_CLIENT_SECRET=shpss_xxx
SHOPIFY_APP_CLIENT_SECRET=shpss_xxx  # backward-compatibel

# Shopify Admin API
SHOPIFY_STORE_DOMAIN=ggh8q9-v1.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_API_VERSION=2024-10

# App / Vercel
NEXT_PUBLIC_APP_URL=https://iselectstore-marktplaats-app.vercel.app
CRON_SECRET=een-sterke-cron-secret
```

## Scopes

De app vraagt deze Shopify-scopes aan:

| Scope | Reden |
|---|---|
| `read_content` | Bestaande functionaliteit (Marktplaats-integratie). |
| `write_content` | Bestaande functionaliteit. |
| `read_products` | Producten lezen, webhooks verwerken, voorraadmeldingen matchen. |
| `write_products` | Metafields schrijven (sold_at), producten (un)publishen. |
| `read_inventory` | Voorraad lezen voor lifecycle en meldingen. |

## Webhooks

Geregistreerde topics:

- `products/update` — sold-image overlay, lifecycle update, voorraadmeldingen.
- `products/create` — nieuwe producten controleren tegen actieve meldingen.
- `app/uninstalled` — cleanup logging.

Registreer webhooks eenmalig via:

```bash
POST /api/webhooks/register
{ "password": "ADMIN_PANEL_PASSWORD" }
```

## Shopify CLI

Shopify CLI 4.x is geïnstalleerd. De backend is gelinkt aan de bestaande app via:

```bash
shopify app config link --client-id=db247c0b3b7c65f9b5d8d798ae30b925
```

Deploy de app-config wijzigingen (scopes, webhooks) met:

```bash
shopify app deploy
```

## Diagnostics

Open `/diagnostics?password=ADMIN_PANEL_PASSWORD` om de verbinding te controleren:

- shop domein
- Client ID
- Admin API status
- geregistreerde webhook topics
- database status

## Beveiliging

- Client secret wordt uitsluitend server-side gebruikt.
- Webhooks worden gevalideerd met HMAC (`X-Shopify-Hmac-Sha256`).
- Cron-routes zijn beveiligd met `CRON_SECRET`.
- Admin-routes zijn beveiligd met `ADMIN_PANEL_PASSWORD`.
- Er worden nooit tokens of secrets gelogd.
