// OpenRouter implementation of VisionProvider — used as an extra fallback
// alongside Gemini/Groq: when both of those hit a rate limit, are
// overloaded, or time out, OpenRouter's free-tier vision models are tried
// next before giving up. OpenAI-compatible chat completions API. Server-side
// only; OPENROUTER_API_KEY never reaches the client.
// Docs: https://openrouter.ai/docs — free vision-capable models rotate over
// time (":free" suffix), check https://openrouter.ai/models?fmt=cards&supported_parameters=image
// if OPENROUTER_MODEL starts returning 404/"model not found".
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "./types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

function buildPrompt(productType: string, allowedFieldKeys: string[], fieldLabels: Record<string, string>, imageCount: number): string {
  const fieldList = allowedFieldKeys.map((k) => `- ${k} (${fieldLabels[k] ?? k})`).join("\n");
  const shape = allowedFieldKeys.map((k) => `  "${k}": { "value": <string of null>, "confidence": <0-1> }`).join(",\n");
  const multiPhotoNote =
    imageCount > 1
      ? `Je krijgt ${imageCount} foto's van HETZELFDE fysieke product. Combineer de informatie uit alle foto's samen tot één antwoord per veld. Als foto's elkaar tegenspreken over hetzelfde veld, kies de meest betrouwbare/duidelijke leesbare waarde en verlaag de confidence voor dat veld.\n\n`
      : "";
  return `Je analyseert ${imageCount > 1 ? "foto's of screenshots" : "een foto of screenshot"} van een tweedehands Apple-product (type: ${productType}) om productkenmerken te herkennen voor een webshop.

${multiPhotoNote}Herken UITSLUITEND deze velden, als en alleen als ze duidelijk leesbaar op de afbeelding(en) staan:
${fieldList}

Regels:
- Verzin NOOIT een waarde. Als een veld niet duidelijk leesbaar is, geef "value": null en een lage confidence (< 0.3), of laat het veld weg.
- Geef een confidence tussen 0 en 1 die je eigen zekerheid weerspiegelt over de leesbaarheid, niet een schatting van hoe waarschijnlijk de waarde is.
- Geef waarden zoals ze letterlijk op het scherm staan (bijv. "512 GB", "94%", "M3 Pro") — normalisatie gebeurt daarna door de applicatie, niet door jou.

Antwoord ALLEEN met geldige JSON, zonder markdown-codeblok, in exact deze vorm (laat velden die je niet ziet gewoon weg):
{
${shape},
  "warnings": [<string>]
}`;
}

/** Some free OpenRouter models wrap JSON in a ```json fence despite instructions not to. */
function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1] : text;
}

export class OpenRouterVisionProvider implements VisionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "meta-llama/llama-3.2-11b-vision-instruct:free") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    const { images, productType, allowedFieldKeys, fieldLabels } = input;

    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Recommended by OpenRouter to identify the calling app; not secret.
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://iselectstore-marktplaats-app.vercel.app",
        "X-Title": "iSelectStore Marktplaats-integratie",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(productType, allowedFieldKeys, fieldLabels, images.length) },
              ...images.map((image: ImageInput) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter Vision-aanroep mislukt (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter gaf geen structured output terug.");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch {
      throw new Error("OpenRouter-response kon niet als JSON worden geparsed.");
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
