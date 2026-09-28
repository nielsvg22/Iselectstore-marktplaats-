// Single place that decides which VisionProvider implementation to use.
// Swapping providers is an env var change, never a code change elsewhere.
import { VisionProvider } from "./types";
import { GroqVisionProvider } from "./groqVisionProvider";
import { OpenAiVisionProvider } from "./openaiVisionProvider";
import { GeminiVisionProvider } from "./geminiVisionProvider";
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
    default:
      throw new Error(`Onbekende AI_PROVIDER: ${name}`);
  }
}

export function createVisionProviderFromEnv(): VisionProvider | null {
  // Gemini is the default: its free tier's rate limits are far more
  // forgiving than Groq's for normal day-to-day testing/use.
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const primary = buildProvider(provider);
  if (!primary) return null;

  // If Groq is configured as well and isn't already the primary, use it as
  // an automatic fallback: a temporary outage or rate limit on one free
  // tier no longer surfaces as "AI-service tijdelijk niet beschikbaar" as
  // long as the other one is up.
  if (provider !== "groq" && process.env.GROQ_API_KEY) {
    const fallback = buildProvider("groq");
    if (fallback) return new FallbackVisionProvider(primary, fallback);
  }

  return primary;
}
