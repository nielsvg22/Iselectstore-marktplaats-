# Voorraadmeldingen — iSelectStore

Bezoekers kunnen zich aanmelden voor een voorraadmelding op basis van
**producttype + model + opslag**. Zodra een product met exact die identiteit
weer op voorraad komt, ontvangen zij automatisch één e-mail.

---

## 1. Volledige flow

### Inschrijven (storefront)

```
productpagina (uitverkocht)
  → snippets/inventory-notification-form.liquid
  → POST {stock_notify_backend_url}/api/inventory/subscribe
     { email, productId }
  → backend resolveProductIdentity(productId)   ← dezelfde resolver als de notifier
  → INSERT ... ON CONFLICT (email, product_type, model, storage)
  → { ok:true, code:"ok" }  of  { ok:true, code:"already_subscribed" }
  → thema toont gelokaliseerde melding via code → locale key
```

Het formulier rendert **alleen** als `current_variant.available == false`.

### Notificaties (backend)

```
products/create webhook  ─┐
products/update webhook  ─┼─→ checkProductObjectAndNotify(product)
cron 05:00 UTC (fallback)┘        │
                                  ├─ resolveProductIdentity(product)
                                  ├─ isAvailable(product)   (voorraad > 0)
                                  ├─ findActiveSubscriptions(type, model, storage)
                                  ├─ claimForNotification(id)      ← atomische lease
                                  ├─ provider.send(...)
                                  ├─ ok   → recordSentNotification() + markNotified()
                                  └─ fout → releaseNotificationClaim()  (retry, geen history)
```

---

## 2. Productidentiteit

Eén gedeelde resolver: `services/shopify/productIdentity.ts`.

| Stap | Bron |
| --- | --- |
| `product_type` | Shopify `product_type` (whitespace-gecollapst) |
| `model` | `$app:mkt.model` → `custom.model` → titel (storage-token verwijderd) |
| `storage` | `custom.storage_gb` → titel-parse |

**Normalisatie** (`normalizeStorage` / `normalizeModel` / `normalizeIdentity`):

| Invoer | Sleutel |
| --- | --- |
| `256 GB` / `256GB` / `256 gb` / `256` | `256GB` |
| `1 TB` / `1tb` | `1TB` (eenheid blijft behouden) |
| leeg / niet-numeriek | `""` (nooit een verzonnen waarde) |

`resolveProductIdentity()` haalt metafields op zodra model én storage niet uit
de titel halen. **Subscribe, webhook en cron gebruiken uitsluitend deze
functie** — er is geen tweede parse-route.

---

## 3. Duplicate subscriptions

- DB-constraint: `UNIQUE (email, product_type, model, storage)`.
- `createSubscription()` returned `{ subscription, created }`
  (`RETURNING ..., (xmax = 0)::boolean AS inserted`).
- `created === false` → endpoint geeft **HTTP 200** met `code: "already_subscribed"`.
- Het thema toont dan `inventory_notify.errors.already_subscribed`
  (*"Je staat al op de lijst voor dit model."*) als info-melding, niet als fout.
- De upsert zet het bestaande record terug naar `active` (opnieuw inschrijven
  na een eerdere melding herbewaakt het abonnement).

Twee gelijktijdige requests kunnen geen tweede record maken: de constraint is
atomisch.

---

## 4. E-mailvalidatie

Server-side in `app/api/inventory/subscribe/route.ts` (dus ook voor clients die
de browservalidatie omzeilen):

- max. 254 tekens, max. 64 tekens local-part
- `local@domain.tld`, geen dubbele punten, geen punt voor/na `@`
- bij falen: **HTTP 400**, `code: "invalid_email"`, **geen DB-insert**

Daarnaast:

- body > 8 kB → 413
- rate limit: `INVENTORY_SUBSCRIBE_RATE_IP` (default 20) per IP en
  `INVENTORY_SUBSCRIBE_RATE_EMAIL` (default 10) per e-mailadres, per 15 minuten
  → 429 met `code: "rate_limited"`

---

## 5. E-mailprovider

Interface: `services/notifications/types.ts` → `EmailProvider`.
Factory: `services/notifications/emailProviderFactory.ts`.

| Provider | Status | Vereist |
| --- | --- | --- |
| **`resend`** | **aanbevolen productieprovider** | `RESEND_API_KEY`, `RESEND_FROM` |
| `postmark` | alternatief | `POSTMARK_API_KEY`, `POSTMARK_FROM` |
| `mock` | alleen development/test | — |

**Productieguard:** met `EMAIL_PROVIDER=mock` (of leeg) in een productieruntime
gooit `createEmailProvider()` een `EmailConfigError` in plaats van stil niets
te doen. Alleen `ALLOW_MOCK_EMAIL=1` zet dat uit.

Ontbrekende sleutels bij `resend`/`postmark` → dezelfde duidelijke fout.
Onbekende provider → fout, geen terugval op mock.

---

## 6. E-mail

Onderwerp: `Je <model> <opslag> is weer op voorraad`

HTML + plain-text fallback (beide worden meegestuurd: Resend `html` + `text`,
Postmark `HtmlBody` + `TextBody`). Bevat: begroeting, productnaam, opslag,
prijs, CTA-knop naar de productpagina, iSelectStore-branding en een compacte
footer. Alle dynamische waarden worden ge-escaped.

---

## 7. Product-URL

```
SHOPIFY_STOREFRONT_URL   (gebruik dit: https://www.iselectstore.nl)
   └─ anders https://SHOPIFY_STORE_DOMAIN
        + /products/{product.handle}
             └─ anders een slug van de titel
```

Nooit een hardcoded test-/Vercel-URL. Is er geen storefront-origin geconfigureerd,
dan wordt er **geen** mail verstuurd (en wordt het gelogd) in plaats van een
dode link te versturen.

---

## 8. Triggers

| Trigger | Wanneer | Bestand |
| --- | --- | --- |
| `products/create` | nieuw product met voorraad > 0 | `app/api/webhooks/products-create` |
| `products/update` | bestaand product 0 → >0 (`isBackInStock`) | `app/api/webhooks/products-update` |
| Cron (fallback) | dagelijks 05:00, alle producten (max. 1000, gepagineerd) | `app/api/cron/inventory-notifications` |
| Handmatig (admin) | `POST /api/inventory/notify-check` | idem |

Webhooks zijn HMAC-geverifieerd met `SHOPIFY_CLIENT_SECRET`.
`listProducts()` paginaert (`limit` + `page`) zodat de cron niet stopt bij 250.

---

## 9. Cron

```
GET/POST /api/cron/inventory-notifications
Authorization: Bearer {CRON_SECRET}
```

- **Fail-closed in productie**: zonder `CRON_SECRET` keurt de route af (401).
  Buiten productie mag het zonder secret (lokale tests).
- `maxDuration = 60`, geen rate limit nodig (alleen Vercel roept hem aan).
- Idempotentie zit in de notificatielaag (zie §10), niet in de cron zelf.

---

## 10. History / idempotency

Twee lagen bescherming:

1. **Lease op de subscription** — `claimForNotification()` doet
   `UPDATE ... SET status='notifying' WHERE id=$1 AND status='active'`.
   Van twee gelijktijdige runs (webhook + cron) wint er exact één; de ander
   krijgt 0 rijen en slaat over. Een lease van 10 minuten herstelt crashes.
2. **Unieke history-index** —
   `UNIQUE (subscription_id, shopify_product_id)` op
   `inventory_notification_history`. De insert gebeurt vóór `markNotified()`;
   verliezen de race alsnog twee runners, dan wint er precies één.

Statussen: `active → notifying → notified` (terminaal tot de gebruiker zich
opnieuw inschrijft).

---

## 11. Gedrag na verzenden

| Situatie | Actie |
| --- | --- |
| verzending ok | history-row (`status='sent'`), `status='notified'`, `notified_at`, `matched_product_id` |
| providerfout / exception | lease vrijgeven (`active`), **geen** history-row, fout gelogd in console + `marktplaats_sync_log` |
| geen storefront-URL | niets versturen, fout loggen, geen lease vasthouden |

---

## 12. Retry

Geen queue nodig: een mislukte run laat het abonnement op `active` staan, dus
de volgende webhook of de dagelijkse cron probeert opnieuw. Er bestaat nooit
een history-row vóór een geslaagde verzending, dus een retry kan niet worden
tegehouden door een eerdere mislukking.

---

## 13. Error codes

| Code | HTTP | Betekenis |
| --- | --- | --- |
| `ok` | 200 | inschrijving opgeslagen |
| `already_subscribed` | 200 | bestond al, geen tweede record |
| `invalid_email` | 400 | e-mail geweigerd server-side |
| `invalid_product` | 400 | productId bestaat niet / malformed |
| `unrecognized_product` | 400 | type of model niet te bepalen |
| `rate_limited` | 429 | te veel aanmeldingen |
| `error` | 500 | onverwachte fout (bericht wordt niet gelekt) |
| `email_not_configured` | 500 | providerconfig mist (cron/notify-check) |

De backend-message is de fallback; het thema toont **primair** de locale key
bij de code.

---

## 14. Translaties

`locales/nl.default.json` + `locales/en.json` (pariteit verplicht), groep
`inventory_notify`:

- `title`, `description`, `email_placeholder`, `email_aria`, `submit`
- `loading`, `success`
- `errors.generic`, `errors.invalid_email`, `errors.invalid_product`,
  `errors.unrecognized_product`, `errors.already_subscribed`,
  `errors.rate_limited`

Alle codes worden door `window.themeStrings.inventoryErrors` in
`layout/theme.liquid` naar de browser gestuurd. Geen hardgecodeerde
Nederlandse meldingen in JS.

---

## 15. CORS

`POST` + `OPTIONS`, `Content-Type`, `Access-Control-Max-Age`. `Access-Control-
Allow-Origin` wordt alleen teruggegeven voor:

1. `NEXT_PUBLIC_APP_URL`
2. `SHOPIFY_STOREFRONT_URL`
3. `SHOPIFY_STORE_DOMAIN`
4. `CORS_ORIGINS` (komma-gescheiden)
5. `https://*.myshopify.com` (theme preview / thema-editor)

Geen `*`.

---

## 16. Privacy

Opgeslagen: e-mailadres, productidentiteit, tijdstempels, meldingsstatus.
Verder niets. Aanmeldingen worden uitsluitend gebruikt om één voorraadmelding
te versturen.

---

## 17. Admin

- `/admin/inventory` — per identiteit: actief / verzonden / totaal / laatste aanmelding
- `/admin/inventory/subscriptions` — individuele aanmeldingen met status en datums
- `/api/inventory/counts`, `/api/inventory/subscriptions` — JSON (beide achter `ADMIN_PANEL_PASSWORD`)
- `/api/inventory/notify-check` — handmatig een product of de hele catalogus scannen

---

## 18. Env vars (Vercel)

Verplicht voor deze feature:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=...
RESEND_FROM=noreply@iselectstore.nl
SHOPIFY_STOREFRONT_URL=https://www.iselectstore.nl
CRON_SECRET=<willekeurig lang token>
```

Bestaande vars die worden hergebruikt (niet dupliceren):

```
DATABASE_URL
SHOPIFY_STORE_DOMAIN
SHOPIFY_API_VERSION
SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET  (of SHOPIFY_APP_CLIENT_*)
NEXT_PUBLIC_APP_URL
ADMIN_PANEL_PASSWORD
```

Optioneel:

```
ALLOW_MOCK_EMAIL=1                      # alleen bewust testen in productie
CORS_ORIGINS=https://extra.example.com
INVENTORY_SUBSCRIBE_RATE_IP=20
INVENTORY_SUBSCRIBE_RATE_EMAIL=10
```

Voor Vercel cron ook `Authorization: Bearer {CRON_SECRET}` instellen bij de
cron-trigger (of de header meesturen via de cron-configuratie).

---

## 19. Testprocedure

### Unit / integratie

```bash
npm run typecheck
npm run lint
npm test                 # 199 tests
```

Relevant:

- `__tests__/productIdentity.test.ts` — normalisatie & fallbacks
- `__tests__/inventoryNotification.test.ts` — claim, lease, retry, URL, mail
- `__tests__/subscribeRoute.test.ts` — validatie, already_subscribed, CORS, rate limit
- `__tests__/emailProviderConfig.test.ts` — productieguard

### End-to-end (echte DB + echte Shopify)

```bash
RUN_E2E=1 npx vitest run __tests__/inventory.e2e.test.ts
```

Draait de zes scenario's:

1. inschrijven op een uitverkocht product → correcte identiteit in de DB
2. dezelfde inschrijving nogmaals → `already_subscribed`, 1 record
3. product met **andere** opslag → géén mail
4. restock exact juist model+opslag → exact 1 mail, history, `notified`
5. drie gelijktijdige runs → exact 1 mail, 1 history-row
6. provider faalt → subscription blijft `active`, geen history, retry slaagt

Alle E2E-rijen worden opgeruimd; echte klantadressen krijgen nooit mail.

### Handmatig

```bash
# inschrijven
curl -X POST https://<app>.vercel.app/api/inventory/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","productId":<uitverkocht-product-id>}'
# → {"ok":true,"code":"ok"}

# nogmaals
# → {"ok":true,"code":"already_subscribed"}

# eenmalig een product forceren (admin)
curl -X POST 'https://<app>.vercel.app/api/inventory/notify-check?password=...' \
  -H 'Content-Type: application/json' -d '{"productId":<id>}'
```

---

## 20. Productiechecklist

- [ ] `EMAIL_PROVIDER=resend` staat **niet** op `mock`
- [ ] `RESEND_API_KEY` + `RESEND_FROM` ingevuld en domein geverifieerd in Resend
- [ ] `SHOPIFY_STOREFRONT_URL` wijst naar het echte winkeldomein
- [ ] `CRON_SECRET` ingeveld (anders weigert de cron)
- [ ] Webhooks `products/create` + `products/update` geregistreerd
- [ ] Unieke index `uq_inventory_notification_history` aanwezig (zie `scripts/setup-db.sql`)
- [ ] Testinschrijving + testrestock uitgevoerd, mail werkelijk aangekomen
- [ ] E2E-suite groen: `RUN_E2E=1 npx vitest run __tests__/inventory.e2e.test.ts`
