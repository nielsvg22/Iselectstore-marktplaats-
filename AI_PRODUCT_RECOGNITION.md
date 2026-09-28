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
  → AIRecognitionPanel.tsx (foto-upload van max. 5 foto's van hetzelfde product, resultaat-UI)
  → POST /api/ai/recognize          (server-side, leest bestaande Shopify-waarden ter vergelijking)
      → ProductImageRecognitionService (lib/ai/productImageRecognitionService.ts)
          → VisionProvider — alle foto's in ÉÉN aanroep, provider combineert zelf
            (lib/ai/geminiVisionProvider.ts — Google Gemini, standaard)
          → FallbackVisionProvider (lib/ai/fallbackVisionProvider.ts) probeert bij een
            fout (rate limit, overload, timeout, serverfout) automatisch de volgende
            geconfigureerde provider (Groq, dan OpenRouter)
      ← genormaliseerde velden + confidence
  → gebruiker bevestigt per veld of "Alles toepassen"
  → POST /api/ai/apply               (schrijft pas dan naar Shopify structured fields)
```

**Meerdere foto's van hetzelfde product**: alle geüploade foto's (max. 5, zie
`MAX_IMAGES_PER_ANALYSIS`) horen bij hetzelfde fysieke product en gaan in één
enkele aanroep naar de provider — die combineert zelf de informatie (bijv.
model van foto 1, batterijconditie van foto 2) tot één resultaat per veld.
Extra foto's boven de 5 worden genegeerd met een waarschuwing in de UI. Groq
staat zelf een limiet van 3 foto's per aanroep toe (zie "Provider" hieronder)
— bij meer dan 3 foto's gebruikt Groq alleen de eerste 3, ook als hij als
fallback wordt aangeroepen.

**Waarom in het Marktplaats-adminpaneel en niet in de Shopify Admin UI
Extensie** (`iselectstore-shopify-app`): die extensie draait in een sterk
gesandboxte iframe zonder file-upload-component en met beperkte netwerktoegang.
Foto-upload + AI-aanroepen horen in een gewone browseromgeving thuis — het
Marktplaats-adminpaneel is daar al voor gebouwd en deelt dezelfde
Shopify-structured-fields (`$app:mkt`-namespace) als de extensie.

## Provider

`VisionProvider`-interface (`lib/ai/types.ts`) — makkelijk te vervangen/uit te
breiden, geconfigureerd via `AI_PROVIDER` + optionele fallback-keys in
`lib/ai/visionProviderFactory.ts`. Vier implementaties:

- **Gemini** (`lib/ai/geminiVisionProvider.ts`) — **standaard/primaire
  provider**. Google's gratis laag heeft een veel ruimer quotum dan Groq's
  gratis laag, wat in de praktijk minder snel "AI-service tijdelijk niet
  beschikbaar" gaf tijdens normaal testen/gebruik. `generateContent`-API met
  `responseMimeType: "application/json"`.
- **Groq** (`lib/ai/groqVisionProvider.ts`) — automatische fallback; gratis
  laag heeft een krap ITPM-quotum (input-tokens-per-minuut) dat bij een paar
  snelle testen achter elkaar al geraakt wordt. OpenAI-compatibele Chat
  Completions API met `response_format: json_object`. Max. 3 afbeeldingen per
  aanroep (Groq's eigen limiet) — bij meer foto's gebruikt Groq alleen de
  eerste 3.
- **OpenRouter** (`lib/ai/openrouterVisionProvider.ts`) — tweede automatische
  fallback, voor als zowel Gemini als Groq tegelijk overbelast/rate-limited
  zijn. Gratis-tier vision-modellen (`:free`-suffix), OpenAI-compatibele Chat
  Completions API.
- **OpenAI** (`lib/ai/openaiVisionProvider.ts`) — optioneel, betaald
  alternatief, met `response_format: json_schema` (strict). Niet in de
  automatische fallback-keten opgenomen (moet expliciet als `AI_PROVIDER`
  gekozen worden).

**Automatische fallback-keten** (`lib/ai/fallbackVisionProvider.ts`): als
naast de primaire provider (`AI_PROVIDER`) ook `GROQ_API_KEY` en/of
`OPENROUTER_API_KEY` zijn ingesteld, worden die automatisch als fallback
geprobeerd — in de volgorde gemini → groq → openrouter, de gekozen primaire
provider overgeslagen. Elke fout (rate limit/429, overload/503, timeout,
serverfout) triggert de volgende provider in de keten; pas als alle
geconfigureerde providers falen krijgt de gebruiker de "AI-service tijdelijk
niet beschikbaar"-melding.

Environment variables (server-side, nooit naar de client):

```
AI_PROVIDER=gemini              # "gemini" (standaard), "groq", "openrouter" of "openai"
GEMINI_API_KEY=                  # leeg = feature staat uit, geeft nette 500-foutmelding
GEMINI_MODEL=gemini-3.8-flash    # zie https://ai.google.dev/gemini-api/docs voor het actuele model

# optioneel — automatisch als fallback gebruikt zodra ingesteld, ongeacht AI_PROVIDER:
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.8-27b
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemma-4-31b-it:free

# alleen nodig als AI_PROVIDER=openai:
AI_API_KEY=
AI_MODEL=gpt-4o
```

Gemini, Groq en OpenRouter vernieuwen hun modellenlijst af en toe — check de
bijbehorende docs (Gemini: https://ai.google.dev/gemini-api/docs, Groq:
https://console.groq.com/docs/vision, OpenRouter:
https://openrouter.ai/models?fmt=cards&supported_parameters=image) als een
`*_MODEL`-env-var een 404/"model not available" oplevert, en werk de env var
bij (geen codewijziging nodig).

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

- **Tussen foto's**: alle foto's van hetzelfde product gaan in één aanroep
  naar de provider, die zelf de informatie combineert. Bij tegenstrijdige
  foto's kiest de AI de meest betrouwbare/leesbare waarde en verlaagt de
  confidence voor dat veld (zie de prompt in elke `*VisionProvider.ts`) — er
  is geen aparte per-foto-conflict-UI meer.
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
