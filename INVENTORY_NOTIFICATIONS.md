# Voorraadmeldingen — iSelectStore

Bezoekers kunnen zich aanmelden voor een voorraadmelding op basis van **producttype + model + opslag**. Wanneer een product met dezelfde identiteit weer op voorraad komt, ontvangen zij automatisch een e-mail.

## Productidentiteit

Matching gebeurt op:

- `product_type` (Shopify product type)
- `model` (Shopify metafield `custom.model` of `$app:mkt.model`; anders uit titel gehaald)
- `storage` (Shopify metafield `custom.storage_gb`; anders uit titel gehaald)

Voorbeeld:

```
product_type: iPhone
model:        iPhone 15 Pro
storage:      256GB
```

## Storefront formulier

- Sectie: `sections/inventory-notification.liquid` (thema-repo).
- Toont alleen bij uitverkochte producten (`current_variant.available == false`).
- Stuurt een POST naar `{NEXT_PUBLIC_APP_URL}/api/inventory/subscribe`.
- Dubbele actieve aanmeldingen voor hetzelfde e-mail + identiteit worden voorkomen.

## Backend flow

```
products/create of products/update webhook
  → updateLifecycleState()
  → checkProductObjectAndNotify()
    → extractProductIdentity()
    → findActiveSubscriptions()
    → createEmailProvider().send()
    → markNotified() + recordNotificationHistory()
```

Daarnaast draait er een cron die elke 15 minuten alle producten scant:

```
POST /api/cron/inventory-notifications  (Vercel cron)
```

## E-mailprovider

Configureerbaar via `EMAIL_PROVIDER`:

- `mock` (default): logt alleen, verstuurt geen echte mail.
- `resend`: vereist `RESEND_API_KEY` + `RESEND_FROM`.
- `postmark`: vereist `POSTMARK_API_KEY` + `POSTMARK_FROM`.

Interface: `services/notifications/types.ts` → `EmailProvider`.

## Aanmeldtellers

Admin-overzichten:

- `/admin/inventory` — totaal per identiteit (actief / verzonden / totaal).
- `/api/inventory/counts` — JSON API voor tellers.
- `/api/inventory/subscriptions` — JSON API voor individuele aanmeldingen.

## Tabellen

- `inventory_notification_subscriptions`
- `inventory_notification_history`

## Testscenario's

1. **Correcte match:**
   - Aanmelding: iPhone 15 Pro / 256GB / test@example.com
   - Nieuw product: iPhone 15 Pro / 256GB / voorraad 1
   - Verwacht: e-mail wordt verzonden (of in mock mode: history row aangemaakt).

2. **Geen verkeerde match:**
   - Aanmelding: iPhone 15 Pro / 256GB
   - Nieuw product: iPhone 15 Pro / 512GB
   - Verwacht: geen melding.

3. **Geen dubbele mail:**
   - Zelfde aanmelding krijgt maar één mail per product.
   - `inventory_notification_history` voorkomt herhaling.
