// Groq Vision implementation of VisionProvider — default provider because
// Groq offers a free/cheap tier, useful while this feature is still being
// validated. Server-side only; GROQ_API_KEY never reaches the client.
// Groq's API is OpenAI-compatible (chat completions + response_format).
// Docs: https://console.groq.com/docs/vision (model lineup changes — check
// there if GROQ_MODEL needs updating).
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "./types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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

export class GroqVisionProvider implements VisionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "qwen/qwen3.8-27b") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyzeImage(input: VisionAnalysisInput & { images: [ImageInput] }): Promise<VisionAnalysisResult> {
    const { images, productType, allowedFieldKeys, fieldLabels } = input;
    const image = images[0];

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(productType, allowedFieldKeys, fieldLabels) },
              { type: "image_url", image_url: { url: image.dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq Vision-aanroep mislukt (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq gaf geen structured output terug.");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Groq-response kon niet als JSON worden geparsed.");
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
