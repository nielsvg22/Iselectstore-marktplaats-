// OpenAI Vision implementation of VisionProvider. Server-side only — never
// import this from a client component. The API key never leaves the server.
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "./types";

function buildJsonSchema(allowedFieldKeys: string[]) {
  return {
    name: "product_recognition",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string", enum: allowedFieldKeys },
              value: { type: ["string", "null"] },
              confidence: { type: "number" },
            },
            required: ["key", "value", "confidence"],
          },
        },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["fields", "warnings"],
    },
  };
}

function buildPrompt(productType: string, allowedFieldKeys: string[], fieldLabels: Record<string, string>): string {
  const fieldList = allowedFieldKeys.map((k) => `- ${k} (${fieldLabels[k] ?? k})`).join("\n");
  return `Je analyseert een foto of screenshot van een tweedehands Apple-product (type: ${productType}) om productkenmerken te herkennen voor een webshop.

Herken UITSLUITEND deze velden, als en alleen als ze duidelijk leesbaar op de afbeelding staan:
${fieldList}

Regels:
- Verzin NOOIT een waarde. Als een veld niet duidelijk leesbaar is, geef "value": null en een lage confidence (< 0.3), of laat het veld weg.
- Geef een confidence tussen 0 en 1 die je eigen zekerheid weerspiegelt over de leesbaarheid, niet een schatting van hoe waarschijnlijk de waarde is.
- Geef waarden zoals ze letterlijk op het scherm staan (bijv. "512 GB", "94%", "M3 Pro") — normalisatie gebeurt daarna door de applicatie, niet door jou.
- Voeg een waarschuwing toe aan "warnings" als de afbeelding geen productinformatie lijkt te bevatten, onscherp is, of niet bij dit producttype past.`;
}

export class OpenAiVisionProvider implements VisionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyzeImage(input: VisionAnalysisInput & { images: [ImageInput] }): Promise<VisionAnalysisResult> {
    const { images, productType, allowedFieldKeys, fieldLabels } = input;
    const image = images[0];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
        response_format: { type: "json_schema", json_schema: buildJsonSchema(allowedFieldKeys) },
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI Vision-aanroep mislukt (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI gaf geen structured output terug.");

    let parsed: { fields?: { key: string; value: string | number | null; confidence: number }[]; warnings?: string[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("OpenAI-response kon niet als JSON worden geparsed.");
    }

    const fields: VisionAnalysisResult["fields"] = {};
    for (const f of parsed.fields ?? []) {
      if (!allowedFieldKeys.includes(f.key)) continue;
      fields[f.key] = { value: f.value, confidence: f.confidence };
    }

    return { fields, warnings: parsed.warnings ?? [] };
  }
}
