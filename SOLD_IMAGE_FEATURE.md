# VERKOCHT-sticker bij uitverkochte producten

Wanneer een Shopify-product uitverkocht raakt (voorraad op 0, met tracking
aan), kan de app automatisch een kopie van de eerste productfoto maken met
een "VERKOCHT"-overlay en die als eerste foto instellen — zodat de bestaande
Marktplaats-koppeling deze meeneemt. De originele foto wordt **nooit**
overschreven of verwijderd.

## Architectuur

Onderdeel van de bestaande Next.js/Vercel-app, geen los systeem:

```
Shopify voorraad → 0
  → webhook products/update (app/api/webhooks/products-update)
      → detectSoldOut.ts (puur, geen I/O): is dit product écht uitverkocht?
      → stateService.markPending()  (sold_image_state tabel, Neon)
      → direct (delay=0): soldImageService.processProductNow() binnen dezelfde
        webhook-aanroep — geen wachttijd
          → haalt eerste foto op (lib/shopify/client.ts)
          → overlay.ts (sharp, puur): tekent VERKOCHT-band
          → addProductImage() + setImagePosition() — origineel blijft ongemoeid
          → stateService.markApplied()
  → dagelijkse cron (app/api/cron/sold-images, vercel.json) als vangnet voor
    rijen met een ingestelde vertraging (X uur) of een eerder mislukte poging

Shopify voorraad weer > 0
  → webhook → stateService.markRestoring() → direct verwerkt (zelfde principe)
      → setImagePosition(origineel, 1) + verwijdert de gegenereerde
        verkocht-foto → stateService.markRestored()
```

**Waarom niet gewoon een cron per X minuten**: Vercel's gratis (Hobby) plan
staat alleen cron-jobs toe die **maximaal 1x per dag** draaien — vaker
vereist een betaald Pro-abonnement. Daarom verwerkt de webhook zelf het
"direct" (0 uur) en het herstel-geval meteen, en dient de dagelijkse cron
alleen als vangnet voor de "na X uur"-instelling en voor eerder mislukte
pogingen. **Concreet gevolg**: "direct" is écht direct (binnen de webhook-
aanroep, meestal < 2 sec.); een ingestelde vertraging van bijv. "6 uur" wordt
in de praktijk pas verwerkt bij de eerstvolgende dagelijkse cron-run (03:00
's nachts) ná die 6 uur — dus mogelijk pas de volgende ochtend, niet exact 6
uur later. Wil je fijnmazigere vertraging, is een Vercel Pro-abonnement
(cron elke X minuten) de aangewezen upgrade — de code hoeft dan alleen het
`schedule`-veld in `vercel.json` aangepast te worden.

## Database (Neon, project `iselectstore-marktplaats`)

- `sold_image_settings` — één rij, globale configuratie (mode, delay,
  stickerstijl).
- `sold_image_state` — één rij per product: welke foto was origineel, welke
  foto is gegenereerd, huidige status (`none`/`pending`/`applied`/
  `restoring`/`restored`/`error`), tijdstippen, laatste foutmelding.

## Bescherming tegen dubbel werk / schade

- **Geen dubbele sticker**: `markPending()` schrijft alleen als de huidige
  status `none`/`restored`/`error` is — een product dat al `pending` of
  `applied` is, wordt genegeerd.
- **Geen onnodige regeneratie**: vlak voor het toepassen wordt de voorraad
  opnieuw gecontroleerd (`processApply` in `soldImageService.ts`) — als het
  product tussentijds weer op voorraad kwam, gebeurt er niets.
- **Nooit het Shopify-product beschadigen bij een fout**: de originele foto
  wordt pas aangepast (herordend) **nadat** de nieuwe verkocht-foto succesvol
  is gegenereerd én geüpload. Iedere fout ervoor resulteert in status
  `error` met de foutmelding gelogd — de bestaande foto's blijven exact
  zoals ze waren.

## Instellingen

`/admin/sold-images` (link vanaf `/admin`):

- **Na verkoop**: niets doen, of automatisch sticker toevoegen.
- **Vertraging**: 0 (direct, binnen één cron-cyclus) of X uur.
- **Sticker-stijl**: tekst, positie (midden/4 hoeken), vorm bij een hoekpositie
  (`ribbon` — standaard, de diagonale banner over de hoek — of `pill` — een
  compacte badge vlak in de hoek, zonder marge, voor wie liever geen diagonaal
  lint wil), grootte (% van fotobreedte), transparantie, bandkleur,
  tekstkleur — huisstijlkleur is dus nu al instelbaar, geen aparte functie
  later nodig.

## Logging

Elke stap logt naar de bestaande `marktplaats_sync_log`-tabel met
`shopify_product_id` en een van deze `action`-waarden: `sold_image_scheduled`,
`sold_image_restore_scheduled`, `sold_image_applied`, `sold_image_restored`,
`sold_image_skipped`, `sold_image_error` — inclusief foutmelding in `message`
bij een fout.

## Eenmalige installatie

1. Zorg dat deze environment variables gezet staan (Vercel): `SHOPIFY_APP_CLIENT_SECRET`
   (al aanwezig sinds de OAuth-koppeling), `NEXT_PUBLIC_APP_URL`, optioneel `CRON_SECRET`.
2. Deploy de app (de `vercel.json` cron wordt dan automatisch geregistreerd door Vercel).
3. Ga naar `/admin/sold-images`, vul het admin-paneel-wachtwoord in bij
   "Eenmalige koppeling" en klik op **Webhook registreren** — dit maakt de
   `products/update`-webhook aan in Shopify. Dit hoeft maar één keer.

## Zelf testen

1. Kies een testproduct met voorraadtracking aan en zet de voorraad op 0
   (via Shopify admin of de API) — of pas de variant handmatig aan.
2. Shopify stuurt de `products/update`-webhook; controleer in
   `marktplaats_sync_log` (of de Neon-tabel `sold_image_state`) dat er een
   rij met status `pending` verschijnt.
3. Wacht op de eerstvolgende cron-run (max. 15 minuten), of roep handmatig
   `GET /api/cron/sold-images` aan (met `Authorization: Bearer <CRON_SECRET>`
   als die gezet is).
4. Open het product in Shopify — de eerste foto moet nu de VERKOCHT-versie
   zijn; de originele foto staat er nog steeds tussen (verderop in de lijst).
5. Zet de voorraad weer op een positief aantal → status gaat naar
   `restoring` → na de volgende cron-run staat de originele foto weer vooraan
   en is de gegenereerde verkocht-foto verwijderd.

## Nieuwe sticker-stijl toevoegen / aanpassen

Alles zit in `lib/soldImage/overlay.ts` (pure functie, geen Shopify/DB-kennis)
— band, tekst, positie-berekening staan daar samen. Nieuwe opties voeg je toe
aan `SoldImageSettings` (`lib/soldImage/types.ts`), de DB-kolom in
`sold_image_settings`, en het formulier in
`app/admin/sold-images/SoldImageSettingsForm.tsx`.
