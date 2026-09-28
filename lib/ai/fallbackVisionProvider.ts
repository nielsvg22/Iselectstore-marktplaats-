// Wraps a primary VisionProvider with a fallback: if the primary throws
// (rate limit, temporary outage, ...), retry once against the fallback
// before giving up. Keeps the two providers' free-tier hiccups from
// compounding into "AI service tijdelijk niet beschikbaar" for the user
// when the other provider would have happily answered.
import { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "./types";

export class FallbackVisionProvider implements VisionProvider {
  constructor(
    private primary: VisionProvider,
    private fallback: VisionProvider
  ) {}

  async analyzeImage(input: VisionAnalysisInput & { images: [ImageInput] }): Promise<VisionAnalysisResult> {
    try {
      return await this.primary.analyzeImage(input);
    } catch (primaryErr) {
      console.error("FallbackVisionProvider: primary provider failed, retrying with fallback", primaryErr);
      try {
        return await this.fallback.analyzeImage(input);
      } catch (fallbackErr) {
        console.error("FallbackVisionProvider: fallback provider also failed", fallbackErr);
        throw fallbackErr;
      }
    }
  }
}
