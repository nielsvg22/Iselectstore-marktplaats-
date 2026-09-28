// Single place that decides which VisionProvider implementation(s) to use.
// Swapping/adding providers is an env var change, never a code change
// elsewhere.
import { VisionProvider } from "./types";
import { GroqVisionProvider } from "./groqVisionProvider";
import { OpenAiVisionProvider } from "./openaiVisionProvider";
import { GeminiVisionProvider } from "./geminiVisionProvider";
import { OpenRouterVisionProvider } from "./openrouterVisionProvider";
import { FallbackVisionProvider } from "./fallbackVisionProvider";

function buildProvider(name: string): VisionProvider | null {
  switch (name) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return null;
      return new GeminiVisionProvider(apiKey, process.env.GEMINI_MODEL || "gemini-3.8-flash");
    }
    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return null;
      return new GroqVisionProvider(apiKey, process.env.GROQ_MODEL || "qwen/qwen3.8-27b");
    }
    case "openai": {
      const apiKey = process.env.AI_API_KEY;
      if (!apiKey) return null;
      return new OpenAiVisionProvider(apiKey, process.env.AI_MODEL || "gpt-4o");
    }
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) return null;
      return new OpenRouterVisionProvider(apiKey, process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free");
    }
    default:
      throw new Error(`Onbekende AI_PROVIDER: ${name}`);
  }
}

export function createVisionProviderFromEnv(): VisionProvider | null {
  // Gemini is the default: its free tier's rate limits are far more
  // forgiving than Groq's for normal day-to-day testing/use.
  const primaryName = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const primary = buildProvider(primaryName);
  if (!primary) return null;

  // Automatic fallback chain: if a fallback provider is configured (and
  // isn't already the primary), it's tried next when the primary hits a
  // rate limit, temporary outage, timeout or server error — so one free
  // tier's hiccup no longer surfaces as "AI-service tijdelijk niet
  // beschikbaar" while another configured provider is available. Groq comes
  // before OpenRouter since it was already the established secondary.
  const chain: VisionProvider[] = [primary];
  for (const name of ["groq", "openrouter"]) {
    if (name === primaryName) continue;
    const provider = buildProvider(name);
    if (provider) chain.push(provider);
  }

  return chain.length > 1 ? new FallbackVisionProvider(chain) : primary;
}
