// Google Gemini implementation of VisionProvider — free tier is generous
// (no credit card needed to start), useful while Groq's free ITPM limit
// keeps getting hit during normal testing. Server-side only; GEMINI_API_KEY
// never reaches the client. Docs: https://ai.google.dev/gemini-api/docs —
// Google renames/retires model ids periodically, check there if GEMINI_MODEL
// starts returning 404 "no longer available".
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "./types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function buildPrompt(productType: string, allowedFieldKeys: string[], fieldLabels: Record<string, string>): string {
  const fieldList = allowedFieldKeys.map((k) => `- ${k} (${fieldLabels[k] ?? k})`).join("\n");
  const shape = allowedFieldKeys.map((k) => `  "${k}": { "value": <string of null>, "confidence": <0-1> }`).join(",\n");
  return `Je analyseert een foto of screenshot van een tweedehands Apple-product (type: ${productType}) om productkenmerken te herkennen voor een webshop.

Herken UITSLUITEND deze velden, als en alleen als ze duidelijk leesbaar op de afbeelding staan:
${fieldList}

Regels:
- Verzin NOOIT een waarde. Als een veld niet duidelijk leesbaar is, geef "value": null en een lage confidence (< 0.3), of laat het veld weg.
- Geef een confidence tussen 0 en 1 die je eigen zekerheid weerspiegelt over de leesbaarheid, niet een schatting van hoe waarschijnlijk de waarde is.
- Geef waarden zoals ze letterlijk op het scherm staan (bijv. "512 GB", "94%", "M3 Pro") — normalisatie gebeurt daarna door de applicatie, niet door jou.

Antwoord ALLEEN met geldige JSON in exact deze vorm (laat velden die je niet ziet gewoon weg):
{
${shape},
  "warnings": [<string>]
}`;
}

/** Splits a "data:image/jpeg;base64,AAAA..." data URL into its mime type and raw base64 payload. */
function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Ongeldige afbeelding-data-URL.");
  return { mimeType: match[1], data: match[2] };
}

export class GeminiVisionProvider implements VisionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gemini-3.8-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyzeImage(input: VisionAnalysisInput & { images: [ImageInput] }): Promise<VisionAnalysisResult> {
    const { images, productType, allowedFieldKeys, fieldLabels } = input;
    const { mimeType, data } = splitDataUrl(images[0].dataUrl);

    const res = await fetch(`${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(productType, allowedFieldKeys, fieldLabels) }, { inline_data: { mime_type: mimeType, data } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini Vision-aanroep mislukt (${res.status}): ${body.slice(0, 500)}`);
    }

    const responseData = await res.json();
    const content = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("Gemini gaf geen structured output terug.");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Gemini-response kon niet als JSON worden geparsed.");
    }

    const fields: VisionAnalysisResult["fields"] = {};
    for (const key of allowedFieldKeys) {
      const entry = parsed[key] as { value?: string | number | null; confidence?: number } | undefined;
      if (!entry || entry.value === undefined || entry.value === null || entry.confidence === undefined) continue;
      fields[key] = { value: entry.value, confidence: entry.confidence };
    }

    const warnings = Array.isArray(parsed.warnings) ? (parsed.warnings as string[]) : [];
    return { fields, warnings };
  }
}
