// Single place that decides which VisionProvider implementation to use.
// Swapping providers is an env var change, never a code change elsewhere.
import { VisionProvider } from "./types";
import { GroqVisionProvider } from "./groqVisionProvider";
import { OpenAiVisionProvider } from "./openaiVisionProvider";

export function createVisionProviderFromEnv(): VisionProvider | null {
  const provider = (process.env.AI_PROVIDER || "groq").toLowerCase();

  switch (provider) {
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
      throw new Error(`Onbekende AI_PROVIDER: ${provider}`);
  }
}
