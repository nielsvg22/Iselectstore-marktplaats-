# AI Producterkenning

Herkent productkenmerken (model, opslag, RAM, chip, batterijconditie, ...) uit
foto's/screenshots die de gebruiker uploadt, en stelt ze voor ter bevestiging.
De AI schrijft **nooit** direct naar Shopify of Marktplaats — alles gaat via
een expliciete "Toepassen"-actie van de gebruiker.

## Architectuur

Onderdeel van de bestaande Next.js/Vercel-app (`iselectstore-marktplaats`),
niet een los systeem:

```
Marktplaats-adminpaneel (app/admin/[productId])
  → AIRecognitionPanel.tsx (foto-upload, resultaat-UI)
  → POST /api/ai/recognize          (server-side, leest bestaande Shopify-waarden ter vergelijking)
      → ProductImageRecognitionService (lib/ai/productImageRecognitionService.ts)
          → VisionProvider (lib/ai/geminiVisionProvider.ts — Google Gemini, structured output)
      ← genormaliseerde velden + confidence + conflicten
  → gebruiker bevestigt per veld of "Alles toepassen"
  → POST /api/ai/apply               (schrijft pas dan naar Shopify structured fields)
```

**Waarom in het Marktplaats-adminpaneel en niet in de Shopify Admin UI
Extensie** (`iselectstore-shopify-app`): die extensie draait in een sterk
gesandboxte iframe zonder file-upload-component en met beperkte netwerktoegang.
Foto-upload + AI-aanroepen horen in een gewone browseromgeving thuis — het
Marktplaats-adminpaneel is daar al voor gebouwd en deelt dezelfde
Shopify-structured-fields (`$app:mkt`-namespace) als de extensie.

## Provider

`VisionProvider`-interface (`lib/ai/types.ts`) — makkelijk te vervangen, kies
via `AI_PROVIDER` in `lib/ai/visionProviderFactory.ts`. Drie implementaties:

- **Gemini** (`lib/ai/geminiVisionProvider.ts`) — **standaard provider**.
  Google's gratis laag heeft een veel ruimer quotum dan Groq's gratis laag,
  wat in de praktijk minder snel "AI-service tijdelijk niet beschikbaar"
  gaf tijdens normaal testen/gebruik. `generateContent`-API met
  `responseMimeType: "application/json"`.
- **Groq** (`lib/ai/groqVisionProvider.ts`) — alternatief, was de
  oorspronkelijke standaard; gratis laag heeft een krap ITPM-quotum
  (input-tokens-per-minuut) dat bij een paar snelle testen achter elkaar al
  geraakt wordt. OpenAI-compatibele Chat Completions API met
  `response_format: json_object`.
- **OpenAI** (`lib/ai/openaiVisionProvider.ts`) — optioneel alternatief, met
  `response_format: json_schema` (strict).

Environment variables (server-side, nooit naar de client):

```
AI_PROVIDER=gemini              # "gemini" (standaard), "groq" of "openai"
GEMINI_API_KEY=                  # leeg = feature staat uit, geeft nette 500-foutmelding
GEMINI_MODEL=gemini-3.8-flash    # zie https://ai.google.dev/gemini-api/docs voor het actuele model

# alleen nodig als AI_PROVIDER=groq:
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.8-27b

# alleen nodig als AI_PROVIDER=openai:
AI_API_KEY=
AI_MODEL=gpt-4o
```

Zowel Gemini als Groq vernieuwen hun modellenlijst af en toe — check de
bijbehorende docs als `GEMINI_MODEL`/`GROQ_MODEL` een 404/"model not
available" oplevert, en werk de env var bij (geen codewijziging nodig).
Groq's limiet: max. 3 afbeeldingen per API-aanroep, 20MB per afbeelding —
geen probleem voor deze integratie, die altijd één foto per aanroep stuurt
(zie "Conflicthantering" hieronder).

## Ondersteunde producttypes en velden

Alleen velden die echt op een foto te zien zijn — nooit conditie, prijs,
accessoires of garantie (dat blijft altijd een menselijke keuze). Zie
`lib/ai/allowedFields.ts`:

| Producttype | Velden |
|---|---|
| iPhone | model, opslag, kleur, batterijconditie, SIM |
| iPad | model, opslag, kleur, batterijconditie |
| MacBook | model, schermformaat, modeljaar, chip, RAM, opslag, kleur, batterijconditie, laadcycli |
| iMac | model, schermformaat, modeljaar, chip, RAM, opslag, kleur |
| Mac mini | model, modeljaar, chip, RAM, opslag |
| Apple Watch | serie, kastmaat, kleur, batterijconditie |

## Ondersteunde screenshots (voorbeelden)

- iPhone/iPad: Instellingen > Batterij > Batterijconditie; Instellingen > Algemeen > Info
- MacBook/iMac/Mac mini: "Over deze Mac", Systeeminformatie, batterij-informatie, opslagoverzicht
- Apple Watch: Instellingen > Info

## Structured output

De provider retourneert nooit vrije tekst als hoofdresultaat:

```json
{
  "fields": [
    { "key": "battery_percentage", "value": "94%", "confidence": 0.99 },
    { "key": "storage_gb", "value": "256 GB", "confidence": 0.86 }
  ],
  "warnings": []
}
```

`ProductImageRecognitionService` normaliseert daarna elke waarde (zie
`lib/ai/normalize.ts`) en filtert op toegestane velden voor het gekozen
producttype vóórdat de UI iets te zien krijgt.

## Confidence

Drie niveaus (`lib/ai/types.ts`, `confidenceLevel()`):

- **HIGH** ≥ 0.90
- **MEDIUM** ≥ 0.70
- **LOW** < 0.70 (en < 0.30 → veld wordt helemaal weggelaten, nooit getoond als gok)

"Alles toepassen" in de UI negeert LOW-velden altijd — die moeten individueel
bevestigd worden.

## Normalisatie

Centrale functies in `lib/ai/normalize.ts`: `normalizeRam`, `normalizeStorage`,
`normalizeBatteryHealth`, `normalizeChip`, `normalizeModel`, plus een generieke
`normalizeText`/`normalizeInteger` voor de rest. Nieuwe velden koppel je toe
via `FIELD_NORMALIZERS` in datzelfde bestand.

## Conflicthantering

- **Tussen foto's**: elke foto wordt apart geanalyseerd; als twee foto's een
  andere waarde geven voor hetzelfde veld, toont de UI beide met een
  "Gebruik deze"-knop per foto. Geen automatische keuze.
- **Met bestaande Shopify-waarde**: als het product al een waarde heeft en de
  AI vindt iets anders, wordt dat **nooit** overschreven — de UI toont
  "Behouden X" / "Gebruik Y" en de gebruiker kiest.

## Privacy

- Foto's gaan alleen als base64 data-URL naar de eigen server en vandaar naar
  de AI-provider; er wordt geen aparte permanente opslag van de afbeelding
  bijgehouden.
- De sync-log (`marktplaats_sync_log`) bevat alleen actie, producttype,
  aantal foto's en veldnamen — nooit de afbeelding zelf of de API-key.

## Testmodus

Checkbox "Testmodus" in het AI-blok: analyseert dezelfde manier, maar slaat
niets op in Shopify (geen bestaande-waarden-vergelijking, geen
"Toepassen"-knoppen) — puur om te zien wat de AI herkent.

## Nieuwe velden toevoegen

1. Voeg de sleutel toe aan `ALLOWED_AI_FIELDS` in `lib/ai/allowedFields.ts` voor het juiste producttype.
2. Zet het bijbehorende Shopify-metafield-type in `AI_FIELD_METAFIELD_TYPE`.
3. Voeg zo nodig een normalizer toe in `lib/ai/normalize.ts` (`FIELD_NORMALIZERS`).
4. Het label komt automatisch uit `FIELD_LIBRARY` (`lib/templates/types.ts`).

## Zelf testen

**iPhone batterijtest:**
1. Open een iPhone-product in `/admin/{productId}`.
2. Maak een screenshot van Instellingen > Batterij > Batterijconditie op een iPhone (of gebruik een bestaande foto met een duidelijk batterijpercentage).
3. Upload de foto in het "AI Producterkenning"-blok, vink evt. "Testmodus" aan, klik op "Gegevens uit foto halen" (of "Test AI herkenning" in testmodus).
4. Controleer dat `battery_percentage` verschijnt met een hoge zekerheid en het juiste percentage.

**MacBook-test:**
1. Open een MacBook-product in `/admin/{productId}`.
2. Maak een screenshot van "Over deze Mac" (model, chip, RAM zichtbaar).
3. Upload, klik op "Gegevens uit foto halen".
4. Controleer dat model, chip (met "Apple "-prefix) en RAM (canonieke "18GB"-vorm) verschijnen.
5. Upload optioneel ook een batterij- en opslagscreenshot erbij om de "meerdere foto's"-flow te testen.
