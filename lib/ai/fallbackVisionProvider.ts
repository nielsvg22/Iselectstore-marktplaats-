// Wraps an ordered chain of VisionProviders: tries each in turn and returns
// the first success. If one throws (rate limit, temporary outage, timeout,
// server error, ...) the next configured provider is tried before giving up,
// so one provider's free-tier hiccup doesn't take the whole feature down
// when another configured provider would have answered fine.
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider } from "./types";

export class FallbackVisionProvider implements VisionProvider {
  private providers: VisionProvider[];

  constructor(providers: VisionProvider[]) {
    if (providers.length === 0) throw new Error("FallbackVisionProvider heeft minstens één provider nodig.");
    this.providers = providers;
  }

  async analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    let lastErr: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      try {
        return await this.providers[i].analyzeImage(input);
      } catch (err) {
        lastErr = err;
        const isLast = i === this.providers.length - 1;
        console.error(
          isLast
            ? "FallbackVisionProvider: all providers failed"
            : `FallbackVisionProvider: provider ${i + 1}/${this.providers.length} failed, trying next`,
          err
        );
      }
    }
    throw lastErr;
  }
}
