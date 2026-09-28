# Catalogus cleanup — iSelectStore

Uitverkochte producten blijven **28 dagen** zichtbaar in de actieve storefrontcatalogus. Daarna worden ze automatisch **uit de Online Store-publicatie gehaald**, maar **niet verwijderd**.

## Hoe het werkt

1. Wanneer een product met voorraadtracking op 0 komt, registreert de webhook `sold_at` in de tabel `product_lifecycle`.
2. Als de voorraad vóór de 28 dagen weer boven 0 komt, wordt `sold_at` gereset.
3. Elke nacht om 04:00 controleert de Vercel-cron `/api/cron/catalog-cleanup` welke producten >= 28 dagen uitverkocht zijn.
4. Die producten worden ge-unpublished uit de Online Store-publicatie via Shopify Admin GraphQL.

## Belangrijke regels

- **Nooit verwijderen:** producten blijven in Shopify bestaan.
- **Alleen Online Store:** de cleanup raakt niet zelfstandig Marktplaats, Google, Meta of andere kanalen.
- **Idempotent:** herhaald uitvoeren van de cron is veilig.
- **Restock voorkomt cleanup:** zolang inventory > 0 blijft, wordt `sold_at` gereset.

## Data

Tabel: `product_lifecycle`

- `shopify_product_id`
- `product_type`, `model`, `storage`
- `inventory_quantity`
- `sold_at`
- `unpublished_at`
- `status` (`active` | `unpublished`)

## Admin

- `/admin/lifecycle` — toont producten die nu uit de catalogus gehaald zouden worden.
- `/api/lifecycle` — JSON API (met `password`).

## Handmatig testen

```bash
# Trigger cleanup handmatig
curl -X POST https://iselectstore-marktplaats-app.vercel.app/api/cron/catalog-cleanup \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Acceptatiecriteria

- inventory 0 + sold_at 27 dagen → nog actief
- inventory 0 + sold_at 28+ dagen → unpublished
- product is niet deleted
- restock vóór 28 dagen → sold_at reset
